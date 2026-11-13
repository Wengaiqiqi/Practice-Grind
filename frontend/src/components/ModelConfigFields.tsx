import { useEffect, useRef, useState } from 'react';
import { List, Loader2 } from 'lucide-react';
import type { ModelListRequest } from '../api/types';
import { ThemedSelect } from './ThemedSelect';

interface ModelConfigFieldsProps {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  hasSavedKey: boolean;
  setProvider: (value: string) => void;
  setBaseUrl: (value: string) => void;
  setApiKey: (value: string) => void;
  setModel: (value: string) => void;
  fetchModels: (payload: ModelListRequest) => Promise<{ models: string[] }>;
}

const protocolOptions = [
  { value: 'openai-compatible', label: 'OpenAI 兼容接口' },
  { value: 'openai', label: 'OpenAI' },
];
const inputClass = 'w-full min-h-[42px] rounded-lg border border-black/10 bg-white px-3 py-2.5 text-[13px] text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-black focus:ring-2 focus:ring-black/10';

export function ModelConfigFields(props: ModelConfigFieldsProps) {
  const { provider, baseUrl, apiKey, model, hasSavedKey, setProvider, setBaseUrl, setApiKey, setModel, fetchModels } = props;
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const requestVersion = useRef(0);

  useEffect(() => {
    requestVersion.current += 1;
    setModels([]);
    setLoading(false);
    setNotice('');
    return () => { requestVersion.current += 1; };
  }, [provider, baseUrl, apiKey]);

  async function loadModels() {
    const version = ++requestVersion.current;
    setLoading(true);
    setNotice('');
    try {
      const result = await fetchModels({ provider, base_url: baseUrl.trim(), ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) });
      if (version !== requestVersion.current) return;
      setModels(result.models.map((value) => ({ value, label: value })));
      setFailed(false);
      setNotice(result.models.length ? `已获取 ${result.models.length} 个模型，点击列表选择，也可以手动填写。` : '服务商未返回可用模型，请手动填写模型名称。');
    } catch (error) {
      if (version !== requestVersion.current) return;
      setModels([]);
      setFailed(true);
      setNotice(error instanceof Error ? error.message : '模型列表获取失败，请检查配置或手动填写。');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <div className="grid gap-2">
        <span className="text-[13px] font-semibold text-zinc-700">协议</span>
        <ThemedSelect label="协议" value={provider} options={protocolOptions} onChange={setProvider} />
      </div>
      <label className="grid gap-2 text-[13px] font-semibold text-zinc-700">
        URL
        <input className={inputClass} type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="填写服务地址，例如 https://api.example.com/v1" required />
      </label>
      <label className="grid gap-2 text-[13px] font-semibold text-zinc-700">
        Key
        <input className={inputClass} type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasSavedKey ? '密钥已保存，留空则保持不变' : '填写 API Key'} />
      </label>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-zinc-700">模型名称</span>
          <button type="button" onClick={loadModels} disabled={loading || !baseUrl.trim() || (!apiKey.trim() && !hasSavedKey)}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-black/10 bg-zinc-50 px-2.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <List size={13} />}
            {loading ? '正在获取…' : '获取模型列表'}
          </button>
        </div>
        <ThemedSelect label="模型名称" value={model} options={models} onChange={setModel} editable required placeholder="获取列表后选择，或手动填写模型名称" openOnLoad />
        {notice ? <p role="status" className={`m-0 text-xs leading-relaxed ${failed ? 'text-red-600' : 'text-zinc-500'}`}>{notice}</p> :
          <p className="m-0 text-xs text-zinc-400">填写 URL 和 Key 后可获取模型列表。</p>}
      </div>
    </div>
  );
}
