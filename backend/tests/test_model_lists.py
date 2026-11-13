import httpx
import pytest
from sqlalchemy import select

from app.models.user import User, UserModelSettings
from app.models.global_settings import GlobalSettings
from app.services.model_settings_service import encrypt_api_key
from tests.conftest import register_and_login


@pytest.fixture
def auth(client):
    token = register_and_login(client, 'list-user', 'unused@example.com')
    return {'Authorization': f'Bearer {token}'}


def mock_models(monkeypatch, status=200, body=None):
    calls = []
    def get(url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(status, json=body if body is not None else {'data': [{'id': 'beta'}, {'id': 'alpha'}, {'id': 'alpha'}, {'id': ''}, {}]}, request=httpx.Request('GET', url))
    monkeypatch.setattr(httpx, 'get', get)
    return calls


def test_fetch_unsaved_config_without_persisting_or_returning_key(client, auth, monkeypatch):
    calls = mock_models(monkeypatch)
    response = client.post('/api/model-settings/models', headers=auth, json={
        'provider': 'openai-compatible', 'base_url': 'https://example.com/v1/', 'api_key': 'temporary-key',
    })
    assert response.status_code == 200
    assert response.json() == {'models': ['alpha', 'beta']}
    assert calls[0][0] == 'https://example.com/v1/models'
    assert calls[0][1]['headers']['Authorization'] == 'Bearer temporary-key'
    assert calls[0][1]['follow_redirects'] is False
    with client.app.state.testing_session_local() as db:
        assert db.scalar(select(UserModelSettings)) is None


def test_saved_key_only_used_for_saved_address(client, auth, monkeypatch):
    client.put('/api/model-settings', headers=auth, json={
        'provider': 'openai-compatible', 'base_url': 'https://example.com/v1', 'model': 'chosen', 'api_key': 'saved-key',
    })
    calls = mock_models(monkeypatch)
    payload = {'provider': 'openai-compatible', 'base_url': 'https://example.com/v1'}
    assert client.post('/api/model-settings/models', headers=auth, json=payload).status_code == 200
    assert calls[0][1]['headers']['Authorization'] == 'Bearer saved-key'
    payload['base_url'] = 'https://other.example/v1'
    assert client.post('/api/model-settings/models', headers=auth, json=payload).status_code == 400
    assert len(calls) == 1


def test_no_access_without_auth_or_to_private_hosts(client, auth, monkeypatch):
    calls = mock_models(monkeypatch)
    payload = {'provider': 'openai-compatible', 'base_url': 'http://169.254.169.254', 'api_key': 'key'}
    assert client.post('/api/model-settings/models', json=payload).status_code in {401, 403}
    assert client.post('/api/model-settings/models', headers=auth, json=payload).status_code == 400
    assert client.post('/api/admin/settings/models', headers=auth, json=payload).status_code == 403
    assert calls == []


@pytest.mark.parametrize('status,body', [(401, {}), (404, {}), (500, {}), (302, {}), (200, {'unexpected': 'format'})])
def test_upstream_errors_are_readable_and_do_not_expose_key(client, auth, monkeypatch, status, body):
    mock_models(monkeypatch, status, body)
    response = client.post('/api/model-settings/models', headers=auth, json={
        'provider': 'openai', 'base_url': 'https://example.com/v1', 'api_key': 'private-secret',
    })
    assert response.status_code == 400
    assert response.json()['detail']
    assert 'private-secret' not in response.text


def test_admin_model_list_uses_global_key_instead_of_personal_key(client, auth, monkeypatch):
    with client.app.state.testing_session_local() as db:
        user = db.scalar(select(User).where(User.username == 'list-user'))
        user.role = 'admin'
        db.add(UserModelSettings(user_id=user.id, provider='openai-compatible', base_url='https://example.com/v1', model='private-model', encrypted_api_key=encrypt_api_key('personal-key')))
        for key, value in {'model_provider': 'openai-compatible', 'model_base_url': 'https://example.com/v1', 'model_api_key': encrypt_api_key('global-key')}.items():
            db.add(GlobalSettings(key=key, value=value))
        db.commit()
    calls = mock_models(monkeypatch)
    response = client.post('/api/admin/settings/models', headers=auth, json={'provider': 'openai-compatible', 'base_url': 'https://example.com/v1'})
    assert response.status_code == 200
    assert calls[0][1]['headers']['Authorization'] == 'Bearer global-key'


def test_new_install_has_no_model_preset(client, auth, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), 'model_api_key', '')
    monkeypatch.setattr(get_settings(), 'model_name', '')
    assert client.get('/api/model-settings', headers=auth).json()['model'] == ''
