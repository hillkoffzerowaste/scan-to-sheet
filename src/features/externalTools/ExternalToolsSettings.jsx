import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { validateExternalToolsConfig } from './externalToolsConfig.js';

function copyConfig(config) {
  return {
    groups: (config?.groups ?? []).map((group) => ({
      ...group,
      links: group.links.map((link) => ({ ...link })),
    })),
  };
}

function createId() {
  return globalThis.crypto.randomUUID();
}

function getUserError(error) {
  if (error?.code === 'EXTERNAL_TOOLS_INVALID') {
    return { code: error.code, message: 'ตรวจสอบชื่อหมวดและข้อมูลลิงก์ให้ครบถ้วนก่อนบันทึก' };
  }
  if (error?.code === 'EXTERNAL_TOOLS_AUTH_REQUIRED') {
    return { code: error.code, message: 'ต้องเข้าสู่ระบบ Firebase ในฐานะ Admin เพื่อบันทึกการตั้งค่า' };
  }
  if (error?.code === 'EXTERNAL_TOOLS_READ_FAILED') {
    return { code: error.code, message: 'อ่านการตั้งค่าร่วมไม่สำเร็จ จึงปิดการแก้ไขและบันทึกไว้ก่อน' };
  }
  return {
    code: typeof error?.code === 'string' ? error.code : 'EXTERNAL_TOOLS_SAVE_FAILED',
    message: 'บันทึกการตั้งค่าไม่สำเร็จ โปรดลองอีกครั้ง',
  };
}

function ExternalToolsSettings({ config, loadStatus, saving, onSave }) {
  const [draft, setDraft] = useState(() => copyConfig(config));
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const disabled = loadStatus !== 'ready' || saving;
  const linkCount = draft.groups.reduce((count, group) => count + group.links.length, 0);

  useEffect(() => {
    if (!dirty) setDraft(copyConfig(config));
  }, [config, dirty]);

  function updateDraft(update) {
    setDraft((current) => update(current));
    setDirty(true);
    setFeedback(null);
  }

  function updateGroup(groupId, update) {
    updateDraft((current) => ({
      groups: current.groups.map((group) => (
        group.id === groupId ? update(group) : group
      )),
    }));
  }

  function updateLink(groupId, linkId, update) {
    updateGroup(groupId, (group) => ({
      ...group,
      links: group.links.map((link) => (
        link.id === linkId ? { ...link, ...update } : link
      )),
    }));
  }

  function addGroup() {
    updateDraft((current) => ({
      groups: [...current.groups, { id: createId(), name: 'หมวดใหม่', links: [] }],
    }));
  }

  function removeGroup(group) {
    if (group.links.length > 0) {
      const confirmed = window.confirm(
        'ลบหมวด “' + group.name + '” และลิงก์ ' + group.links.length + ' รายการออกจากรายการร่วมใช่หรือไม่?',
      );
      if (!confirmed) return;
    }
    updateDraft((current) => ({
      groups: current.groups.filter((item) => item.id !== group.id),
    }));
  }

  function addLink(groupId) {
    updateGroup(groupId, (group) => ({
      ...group,
      links: [...group.links, { id: createId(), label: '', url: '' }],
    }));
  }

  function removeLink(groupId, linkId) {
    updateGroup(groupId, (group) => ({
      ...group,
      links: group.links.filter((link) => link.id !== linkId),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (disabled || !dirty) return;

    try {
      const normalized = validateExternalToolsConfig(draft);
      const saved = await onSave(normalized);
      setDraft(copyConfig(saved ?? normalized));
      setDirty(false);
      setFeedback({ type: 'success', message: 'บันทึกการตั้งค่าแล้ว ทุกเครื่องจะเห็นรายการใหม่นี้' });
    } catch (error) {
      const userError = getUserError(error);
      setFeedback({ type: 'error', ...userError });
    }
  }

  return (
    <section className="external-tools-settings" data-testid="external-tools-settings" aria-labelledby="external-tools-settings-title">
      <header className="external-tools-settings-header">
        <div>
          <h1 id="external-tools-settings-title">ตั้งค่าเครื่องมือภายนอก</h1>
          <p>จัดการชื่อหมวดและลิงก์ที่แสดงในเมนูของพนักงานทุกเครื่อง</p>
        </div>
        <button
          className="secondary-button external-tools-save"
          type="submit"
          form="external-tools-settings-form"
          data-testid="external-tools-save"
          disabled={disabled || !dirty}
        >
          <Save size={16} aria-hidden="true" />
          บันทึกการเปลี่ยนแปลง
        </button>
      </header>

      {loadStatus === 'loading' && (
        <p className="external-tools-settings-notice" role="status">กำลังอ่านการตั้งค่าร่วม</p>
      )}
      {loadStatus === 'error' && (
        <p className="external-tools-settings-notice error" data-error-code="EXTERNAL_TOOLS_READ_FAILED" role="alert">
          อ่านการตั้งค่าร่วมไม่สำเร็จ จึงปิดการแก้ไขและบันทึกไว้ก่อน
        </p>
      )}
      {feedback && (
        <p className={'external-tools-settings-notice ' + feedback.type} data-error-code={feedback.code} role={feedback.type === 'error' ? 'alert' : 'status'}>
          {feedback.message}
        </p>
      )}

      <form id="external-tools-settings-form" onSubmit={handleSubmit} noValidate>
        <div className="external-tools-groups">
          {draft.groups.map((group, groupIndex) => (
            <section className="external-tools-group" data-testid={'external-tools-group-' + group.id} key={group.id}>
              <header className="external-tools-group-header">
                <div className="external-tools-field">
                  <label htmlFor={'external-tools-group-name-' + group.id}>ชื่อหมวด {groupIndex + 1}</label>
                  <input
                    id={'external-tools-group-name-' + group.id}
                    data-testid={'external-tools-group-name-' + group.id}
                    type="text"
                    value={group.name}
                    onChange={(event) => updateGroup(group.id, (current) => ({ ...current, name: event.target.value }))}
                    disabled={disabled}
                    required
                  />
                </div>
                <button
                  className="ghost-button external-tools-delete"
                  type="button"
                  onClick={() => removeGroup(group)}
                  disabled={disabled}
                  aria-label={'ลบหมวด ' + group.name}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  ลบหมวด
                </button>
              </header>

              <div className="external-tools-links">
                {group.links.map((link, linkIndex) => (
                  <div className="external-tools-link" data-testid={'external-tools-link-' + link.id} key={link.id}>
                    <div className="external-tools-field">
                      <label htmlFor={'external-tools-link-label-' + link.id}>ชื่อเครื่องมือ {linkIndex + 1}</label>
                      <input
                        id={'external-tools-link-label-' + link.id}
                        data-testid={'external-tools-link-label-' + link.id}
                        type="text"
                        value={link.label}
                        onChange={(event) => updateLink(group.id, link.id, { label: event.target.value })}
                        disabled={disabled}
                        required
                      />
                    </div>
                    <div className="external-tools-field">
                      <label htmlFor={'external-tools-link-url-' + link.id}>ลิงก์ URL</label>
                      <input
                        id={'external-tools-link-url-' + link.id}
                        data-testid={'external-tools-link-url-' + link.id}
                        type="url"
                        value={link.url}
                        onChange={(event) => updateLink(group.id, link.id, { url: event.target.value })}
                        disabled={disabled}
                        required
                      />
                    </div>
                    <button
                      className="ghost-button external-tools-delete-link"
                      type="button"
                      onClick={() => removeLink(group.id, link.id)}
                      disabled={disabled}
                      aria-label={'ลบลิงก์ ' + link.label}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      ลบลิงก์
                    </button>
                  </div>
                ))}
              </div>

              <button
                className="ghost-button external-tools-add-link"
                type="button"
                onClick={() => addLink(group.id)}
                disabled={disabled || linkCount >= 100}
              >
                <Plus size={16} aria-hidden="true" />
                เพิ่มลิงก์
              </button>
            </section>
          ))}
        </div>

        <div className="external-tools-settings-actions">
          <button className="ghost-button" type="button" onClick={addGroup} disabled={disabled || draft.groups.length >= 10}>
            <Plus size={16} aria-hidden="true" />
            เพิ่มหมวด
          </button>
          <span>{draft.groups.length} จาก 10 หมวด · {linkCount} จาก 100 ลิงก์</span>
        </div>
      </form>
    </section>
  );
}

export default ExternalToolsSettings;
