import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { PlugZap, Save, Settings2, Info } from 'lucide-react';

import { fetchModelList, getModelSettings, saveModelSettings, testModelSettings } from '../../api/client';
import type { ModelSettings } from '../../api/types';
import { ModelConfigFields } from '../../components/ModelConfigFields';
import { StatusBadge } from '../../components/StatusBadge';

export function ModelSettingsPage() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [provider, setProvider] = useState('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showCustom, setShowCustom] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getModelSettings()
      .then((current) => {
        if (!isMounted) return;
        setSettings(current);
        setProvider(current.provider ?? 'openai-compatible');
        setBaseUrl(current.base_url ?? 'https://api.openai.com/v1');
        setModel(current.model ?? '');
        // If user has their own key, show custom form
        if (current.has_api_key) {
          setShowCustom(true);
        }
      })
      .catch((caught) => {
        if (isMounted) setMessage({ tone: 'danger', text: caught instanceof Error ? caught.message : '模型设置加载失败' });
      });
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);
    try {
      const saved = await saveModelSettings({ provider, base_url: baseUrl, model, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) });
      setSettings(saved);
      setApiKey('');
      setShowCustom(true);
      setMessage({ tone: 'success', text: '个人模型设置已保存' });
    } catch (caught) {
      setMessage({ tone: 'danger', text: caught instanceof Error ? caught.message : '模型设置保存失败' });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTest() {
    setIsTesting(true);
    setMessage(null);
    try {
      const result = await testModelSettings();
      setMessage({ tone: result.ok ? 'success' : 'danger', text: result.ok ? `连接成功：${result.model}` : result.message ?? '连接失败' });
    } catch (caught) {
      setMessage({ tone: 'danger', text: caught instanceof Error ? caught.message : '连接测试失败' });
    } finally {
      setIsTesting(false);
    }
  }

  const isUsingGlobal = settings?.using_global && !settings?.has_api_key;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
      <header className="pb-6 border-b border-black/[0.06]">
        <h2 className="m-0 text-3xl font-bold text-black tracking-tight leading-tight">引擎设置</h2>
        <p className="mt-2 text-[14px] text-zinc-500 font-medium">配置与 OpenAI 兼容的模型服务，用于文档题库生成。</p>
      </header>

      {/* Global default notice */}
      {isUsingGlobal && !showCustom && (
        <section className="bg-white rounded-xl shadow-sm border border-black/[0.06] overflow-hidden">
          <div className="p-5 border-b border-black/[0.06] flex items-center gap-2 bg-zinc-50/50">
            <Settings2 size={16} className="text-black" />
            <h3 className="text-[14px] font-bold text-black uppercase tracking-widest">当前配置</h3>
            <StatusBadge className="bg-blue-50 text-blue-700 ml-auto">
              使用全局默认
            </StatusBadge>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50/50 border border-blue-200/60">
              <Info size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="text-[13px] text-blue-700 leading-relaxed">
                当前使用管理员配置的全局默认模型。如需使用自己的 API Key，请点击下方按钮切换到自定义配置。
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-3 rounded-md bg-zinc-50 border border-black/[0.06]">
                <div className="text-[11px] text-zinc-400 font-semibold uppercase tracking-widest mb-1">服务商</div>
                <div className="text-[14px] font-semibold text-black">{settings?.provider || '—'}</div>
              </div>
              <div className="p-3 rounded-md bg-zinc-50 border border-black/[0.06]">
                <div className="text-[11px] text-zinc-400 font-semibold uppercase tracking-widest mb-1">模型</div>
                <div className="text-[14px] font-semibold text-black">{settings?.model || '—'}</div>
              </div>
              <div className="p-3 rounded-md bg-zinc-50 border border-black/[0.06]">
                <div className="text-[11px] text-zinc-400 font-semibold uppercase tracking-widest mb-1">Base URL</div>
                <div className="text-[14px] font-semibold text-black truncate">{settings?.base_url || '—'}</div>
              </div>
            </div>
            {message && (
              <div className={`px-3 py-2.5 border rounded-lg text-[13px] font-medium ${
                message.tone === 'success'
                  ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                  : 'border-red-200 text-red-700 bg-red-50'
              }`} role="status">
                {message.text}
              </div>
            )}
            <div className="flex justify-end gap-2.5">
              <button
                className="inline-flex items-center gap-2 min-h-[36px] px-3 rounded-lg border border-slate-300 text-slate-700 bg-white text-[13px] font-bold hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                type="button"
                onClick={handleTest}
                disabled={isTesting}
              >
                <PlugZap size={16} />
                {isTesting ? '正在测试' : '测试连接'}
              </button>
              <button
                className="inline-flex items-center gap-2 min-h-[36px] px-3.5 rounded-lg border border-black bg-black text-white text-[13px] font-bold hover:bg-zinc-800"
                type="button"
                onClick={() => setShowCustom(true)}
              >
                自定义配置
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Custom config form */}
      {(showCustom || !isUsingGlobal || settings?.has_api_key) && (
        <section className="border border-slate-200 rounded-xl bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-slate-700">
                {settings?.has_api_key ? '个人配置' : '自定义配置'}
              </span>
            </div>
            <StatusBadge
              className={
                settings?.has_api_key
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }
            >
              {settings?.has_api_key ? '已配置个人密钥' : '等待配置'}
            </StatusBadge>
          </div>
          <form className="grid grid-cols-1 gap-5 p-5 sm:p-6" aria-label="模型设置" onSubmit={handleSave}>
            <ModelConfigFields
              provider={provider} baseUrl={baseUrl} apiKey={apiKey} model={model}
              setProvider={setProvider} setBaseUrl={setBaseUrl} setApiKey={setApiKey} setModel={setModel}
              hasSavedKey={Boolean(settings?.has_api_key || settings?.platform_available)} fetchModels={fetchModelList}
            />
            {message ? (
              <div
                className={`col-span-full px-3 py-2.5 border rounded-lg font-bold ${
                  message.tone === 'success'
                    ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                    : 'border-red-200 text-red-700 bg-red-50'
                }`}
                role="status"
              >
                {message.text}
              </div>
            ) : null}
            <div className="col-span-full flex justify-end gap-2.5 max-md:flex-col-reverse">
              <button
                className="inline-flex items-center gap-2 min-h-[36px] px-3 rounded-lg border border-slate-300 text-slate-700 bg-white text-[13px] font-bold hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                type="button"
                onClick={handleTest}
                disabled={isTesting || isSaving}
              >
                <PlugZap size={16} aria-hidden="true" />
                {isTesting ? '正在测试' : '测试连接'}
              </button>
              <button
                className="inline-flex items-center gap-2 min-h-[36px] min-w-[132px] px-3.5 rounded-lg border border-black bg-black text-white text-[13px] font-bold hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-not-allowed"
                type="submit"
                disabled={isSaving || isTesting}
              >
                <Save size={16} aria-hidden="true" />
                {isSaving ? '正在保存' : '保存设置'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
