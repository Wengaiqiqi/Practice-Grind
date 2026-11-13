import base64
import hashlib
import logging
from dataclasses import dataclass

from cryptography.fernet import Fernet
from app.core.exceptions import BadRequestError
from app.core.validators import validate_base_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.global_settings import GlobalSettings
from app.models.user import User, UserModelSettings
from app.schemas.model_settings import ModelListRequest, ModelSettingsResponse, ModelSettingsUpdate
from app.services.llm_client import LLMConfig

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResolvedModelConfig:
    provider: str
    base_url: str
    model: str
    api_key: str


_fernet_instance: Fernet | None = None


def _fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is None:
        secret = get_settings().api_key_encryption_secret.encode("utf-8")
        key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
        _fernet_instance = Fernet(key)
    return _fernet_instance


def encrypt_api_key(api_key: str) -> str:
    return _fernet().encrypt(api_key.encode("utf-8")).decode("utf-8")


def decrypt_api_key(encrypted_api_key: str) -> str:
    return _fernet().decrypt(encrypted_api_key.encode("utf-8")).decode("utf-8")


def _get_global_setting(db: Session, key: str) -> str:
    row = db.scalar(select(GlobalSettings).where(GlobalSettings.key == key))
    return row.value if row else ""


def _get_global_settings_batch(db: Session, keys: list[str]) -> dict[str, str]:
    """Fetch multiple global settings in a single query."""
    rows = db.execute(
        select(GlobalSettings).where(GlobalSettings.key.in_(keys))
    ).scalars().all()
    return {row.key: row.value for row in rows}


def get_model_settings(db: Session, user: User) -> ModelSettingsResponse:
    user_settings = db.scalar(select(UserModelSettings).where(UserModelSettings.user_id == user.id))
    platform_available = bool(get_settings().model_api_key)
    if user_settings is None:
        # Fall back to global admin settings, then platform env
        global_provider = _get_global_setting(db, "model_provider")
        global_base_url = _get_global_setting(db, "model_base_url")
        global_model = _get_global_setting(db, "model_name")
        global_has_key = bool(_get_global_setting(db, "model_api_key"))
        if global_has_key:
            return ModelSettingsResponse(
                provider=global_provider,
                base_url=global_base_url,
                model=global_model,
                has_api_key=False,
                platform_available=True,
                using_global=True,
            )
        settings = get_settings()
        return ModelSettingsResponse(
            provider=settings.model_provider,
            base_url=settings.model_base_url,
            model=settings.model_name,
            has_api_key=False,
            platform_available=platform_available,
        )

    return ModelSettingsResponse(
        provider=user_settings.provider,
        base_url=user_settings.base_url,
        model=user_settings.model,
        has_api_key=bool(user_settings.encrypted_api_key),
        platform_available=platform_available,
    )


def save_model_settings(db: Session, user: User, payload: ModelSettingsUpdate) -> ModelSettingsResponse:
    user_settings = db.scalar(select(UserModelSettings).where(UserModelSettings.user_id == user.id))
    if user_settings is None:
        if payload.api_key is None:
            raise BadRequestError("首次配置需要提供 API Key")
        user_settings = UserModelSettings(user_id=user.id)
        db.add(user_settings)

    validate_base_url(payload.base_url.strip())
    user_settings.provider = payload.provider.strip()
    user_settings.base_url = payload.base_url.strip().rstrip("/")
    user_settings.model = payload.model.strip()
    if payload.api_key is not None:
        user_settings.encrypted_api_key = encrypt_api_key(payload.api_key.strip())

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        user_settings = db.scalar(select(UserModelSettings).where(UserModelSettings.user_id == user.id))
        if user_settings is None:
            raise
        user_settings.provider = payload.provider.strip()
        user_settings.base_url = payload.base_url.strip().rstrip("/")
        user_settings.model = payload.model.strip()
        if payload.api_key is not None:
            user_settings.encrypted_api_key = encrypt_api_key(payload.api_key.strip())
        db.commit()
    db.refresh(user_settings)
    return get_model_settings(db, user)


def resolve_model_config(db: Session, user: User) -> ResolvedModelConfig:
    user_settings = db.scalar(select(UserModelSettings).where(UserModelSettings.user_id == user.id))
    if user_settings is not None and user_settings.encrypted_api_key:
        validate_base_url(user_settings.base_url)
        return ResolvedModelConfig(
            provider=user_settings.provider,
            base_url=user_settings.base_url,
            model=user_settings.model,
            api_key=decrypt_api_key(user_settings.encrypted_api_key),
        )

    # Fall back to global admin settings (single batch query)
    global_settings = _get_global_settings_batch(db, ["model_api_key", "model_provider", "model_base_url", "model_name"])
    global_api_key = global_settings.get("model_api_key", "")
    if global_api_key:
        try:
            decrypted = decrypt_api_key(global_api_key)
        except Exception as e:
            logger.warning(f"Failed to decrypt global API key: {e}")
            decrypted = None

        if decrypted:
            global_base_url = global_settings.get("model_base_url", "")
            validate_base_url(global_base_url)
            return ResolvedModelConfig(
                provider=global_settings.get("model_provider", ""),
                base_url=global_base_url,
                model=global_settings.get("model_name", ""),
                api_key=decrypted,
            )

    settings = get_settings()
    if settings.model_api_key:
        validate_base_url(settings.model_base_url)
        return ResolvedModelConfig(
            provider=settings.model_provider,
            base_url=settings.model_base_url,
            model=settings.model_name,
            api_key=settings.model_api_key,
        )

    raise BadRequestError("未配置模型 API Key，请先在引擎设置中配置")


def list_available_models(
    db: Session, user: User, payload: ModelListRequest, *, global_scope: bool = False
) -> dict[str, list[str]]:
    import httpx

    base_url = payload.base_url.strip().rstrip("/")
    provider = payload.provider.strip()
    if provider not in {"openai", "openai-compatible"}:
        raise BadRequestError("暂不支持此协议")
    validate_base_url(base_url)
    api_key = (payload.api_key or "").strip()

    # A stored credential may only be reused with its saved service address.
    # Fetching a model list must not save a partial form or expose the secret.
    if not api_key:
        candidates: list[tuple[str, str, str]] = []
        if not global_scope:
            personal = db.scalar(select(UserModelSettings).where(UserModelSettings.user_id == user.id))
            if personal and personal.encrypted_api_key:
                candidates.append((personal.provider, personal.base_url, personal.encrypted_api_key))
        if global_scope or not candidates:
            global_config = _get_global_settings_batch(db, ["model_provider", "model_base_url", "model_api_key"])
            if global_config.get("model_api_key"):
                candidates.append((global_config.get("model_provider", ""), global_config.get("model_base_url", ""), global_config["model_api_key"]))
        for saved_provider, saved_url, encrypted in candidates:
            if saved_provider == provider and saved_url.strip().rstrip("/") == base_url:
                try:
                    api_key = decrypt_api_key(encrypted)
                except Exception:
                    raise BadRequestError("已保存的密钥无法读取，请重新填写 Key") from None
                break
        if not api_key and not global_scope and not candidates:
            env = get_settings()
            if env.model_provider == provider and env.model_base_url.rstrip("/") == base_url:
                api_key = env.model_api_key
        if not api_key:
            raise BadRequestError("请填写 Key；修改协议或 URL 后需要重新填写密钥")

    try:
        response = httpx.get(
            f"{base_url}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
            follow_redirects=False,
        )
        if response.status_code in {401, 403}:
            raise BadRequestError("密钥无效或无权获取模型列表，请检查 Key")
        if response.status_code == 404:
            raise BadRequestError("该 URL 不支持模型列表，请检查地址，或手动填写模型名称")
        if not 200 <= response.status_code < 300:
            raise BadRequestError(f"获取模型列表失败（HTTP {response.status_code}），请稍后重试或手动填写")
        body = response.json()
    except httpx.TimeoutException:
        raise BadRequestError("获取模型列表超时，请稍后重试或手动填写") from None
    except httpx.HTTPError:
        raise BadRequestError("无法连接模型服务，请检查 URL 或手动填写模型名称") from None
    except ValueError:
        raise BadRequestError("服务商返回的模型列表格式无效，请手动填写模型名称") from None
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, list):
        raise BadRequestError("服务商未返回兼容的模型列表，请手动填写模型名称")
    models = sorted({
        item["id"].strip() for item in data
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"].strip()
    })
    return {"models": models}


def test_model_connection(config: ResolvedModelConfig) -> dict[str, object]:
    validate_base_url(config.base_url)
    llm_config = LLMConfig(
        provider=config.provider,
        base_url=config.base_url,
        model=config.model,
        api_key=config.api_key,
    )
    try:
        import httpx
    except ModuleNotFoundError as exc:
        if get_settings().is_development_like():
            return {
                "ok": False,
                "provider": llm_config.provider,
                "model": llm_config.model,
                "message": "httpx is not installed; connection test was not executed",
            }
        raise RuntimeError("httpx is required to test model connections") from exc

    url = f"{llm_config.base_url.rstrip('/')}/chat/completions"
    try:
        response = httpx.post(
            url,
            headers={"Authorization": f"Bearer {llm_config.api_key}"},
            json={
                "model": llm_config.model,
                "messages": [{"role": "user", "content": "Reply with ok."}],
                "max_tokens": 16,
            },
            timeout=15,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        return {
            "ok": False,
            "provider": llm_config.provider,
            "model": llm_config.model,
            "message": f"Provider returned HTTP {exc.response.status_code}",
        }
    except httpx.HTTPError:
        return {
            "ok": False,
            "provider": llm_config.provider,
            "model": llm_config.model,
            "message": "Could not connect to model provider",
        }
    return {"ok": True, "provider": llm_config.provider, "model": llm_config.model}
