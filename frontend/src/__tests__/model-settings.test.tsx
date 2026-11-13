import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelSettingsPage } from '../features/settings/ModelSettingsPage';

function json(data: unknown) { return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('model settings', () => {
  it('starts without a preset, offers a themed protocol dropdown and fetches unsaved models', async () => {
    const user = userEvent.setup();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/models')) {
        expect(JSON.parse(init!.body as string)).toMatchObject({ base_url: 'https://example.com/v1', api_key: 'my-key' });
        return json({ models: ['model-a', 'model-b'] });
      }
      return json({ provider: 'openai-compatible', base_url: 'https://example.com/v1', model: null, has_api_key: false, using_global: false, platform_available: false });
    });
    render(<ModelSettingsPage />);
    await screen.findByDisplayValue('https://example.com/v1');
    expect(screen.getByRole('combobox', { name: '模型名称' })).toHaveValue('');
    await user.click(screen.getByRole('combobox', { name: '协议' }));
    const protocols = screen.getByRole('listbox', { name: '协议' });
    await user.click(within(protocols).getByRole('option', { name: 'OpenAI' }));
    expect(screen.getByRole('combobox', { name: '协议' })).toHaveTextContent('OpenAI');
    await user.type(screen.getByLabelText('Key'), 'my-key');
    await user.click(screen.getByRole('button', { name: '获取模型列表' }));
    const list = await screen.findByRole('listbox', { name: '模型名称' });
    await user.click(within(list).getByRole('option', { name: 'model-b' }));
    expect(screen.getByRole('combobox', { name: '模型名称' })).toHaveValue('model-b');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains manual model entry and reports an unavailable model list', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/models')) return new Response(JSON.stringify({ detail: '该 URL 不支持模型列表' }), { status: 400 });
      return json({ provider: 'openai-compatible', base_url: 'https://example.com/v1', model: 'my-existing-model', has_api_key: true, using_global: false, platform_available: false });
    });
    render(<ModelSettingsPage />);
    await screen.findByDisplayValue('my-existing-model');
    await user.click(screen.getByRole('button', { name: '获取模型列表' }));
    expect(await screen.findByText('该 URL 不支持模型列表')).toBeInTheDocument();
    const model = screen.getByRole('combobox', { name: '模型名称' });
    await user.clear(model);
    await user.type(model, 'custom-model');
    expect(model).toHaveValue('custom-model');
  });

  it('ignores a previous provider response after the URL changes', async () => {
    const user = userEvent.setup();
    let complete: (response: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/models')) return new Promise<Response>((resolve) => { complete = resolve; });
      return json({ provider: 'openai-compatible', base_url: 'https://example.com/v1', model: null, has_api_key: true, using_global: false, platform_available: false });
    });
    render(<ModelSettingsPage />);
    await screen.findByDisplayValue('https://example.com/v1');
    await user.click(screen.getByRole('button', { name: '获取模型列表' }));
    await user.type(screen.getByLabelText('URL'), '/other');
    await act(async () => { complete(json({ models: ['old-provider-model'] })); });
    expect(screen.queryByRole('option', { name: 'old-provider-model' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '模型名称' })).toHaveValue('');
  });
});
