import { describe, it, expect } from 'vitest';

import { historyToUiMessage } from '../../../../src/frontend/src/pages/ChatPage/context/ChatContext';

/**
 * historyToUiMessage maps a persisted conversation-history row to the
 * in-memory ChatUiMessage shape. The load-bearing invariants:
 *
 *  - system → assistant role normalization (user/assistant pass through)
 *  - attachments / entities are attached ONLY when present AND non-empty.
 *    The empty-array omission matters: ChatMessages renders chips with
 *    `message.entities ?? chipEntities`. An empty `entities: []` is a
 *    non-null value, so it would suppress the session-trace fallback and
 *    show NO chips on the live turn. Omitting the key keeps the fallback.
 */
describe('historyToUiMessage', () => {
  it('passes through a user message', () => {
    const r = historyToUiMessage({ role: 'user', content: 'hi' });
    expect(r).toEqual({ role: 'user', content: 'hi' });
  });

  it('passes through an assistant message', () => {
    const r = historyToUiMessage({ role: 'assistant', content: 'hello' });
    expect(r).toEqual({ role: 'assistant', content: 'hello' });
  });

  it('normalizes a system message to assistant', () => {
    const r = historyToUiMessage({ role: 'system', content: 'sys note' });
    expect(r.role).toBe('assistant');
    expect(r.content).toBe('sys note');
  });

  it('attaches wb_entities as entities when present and non-empty', () => {
    const ents = [
      { entity_id: 'Apps/F/R1', display_name: 'Product A - 1.2.3', entity_type: 'release' },
    ];
    const r = historyToUiMessage({
      role: 'assistant',
      content: 'Releases…',
      metadata: { wb_entities: ents },
    });
    expect(r.entities).toEqual(ents);
  });

  it('does NOT attach entities for an empty wb_entities array (keeps the chipEntities fallback)', () => {
    const r = historyToUiMessage({
      role: 'assistant',
      content: 'x',
      metadata: { wb_entities: [] },
    });
    expect(r).not.toHaveProperty('entities');
  });

  it('attaches attachments when present and non-empty', () => {
    const atts = [{ upload_id: 'u1', filename: 'a.pdf' }];
    const r = historyToUiMessage({
      role: 'assistant',
      content: 'see file',
      metadata: { attachments: atts },
    });
    expect(r.attachments).toEqual(atts);
  });

  it('does NOT attach attachments for an empty array', () => {
    const r = historyToUiMessage({
      role: 'assistant',
      content: 'x',
      metadata: { attachments: [] },
    });
    expect(r).not.toHaveProperty('attachments');
  });

  it('carries both attachments and entities when both are present', () => {
    const atts = [{ upload_id: 'u1', filename: 'a.pdf' }];
    const ents = [{ entity_id: 'R1', display_name: 'Rel', entity_type: 'release' }];
    const r = historyToUiMessage({
      role: 'assistant',
      content: 'x',
      metadata: { attachments: atts, wb_entities: ents },
    });
    expect(r.attachments).toEqual(atts);
    expect(r.entities).toEqual(ents);
  });

  it('handles missing metadata without attachments/entities keys', () => {
    const r = historyToUiMessage({ role: 'assistant', content: 'x' });
    expect(r).not.toHaveProperty('attachments');
    expect(r).not.toHaveProperty('entities');
  });

  it('ignores unrelated metadata keys', () => {
    const r = historyToUiMessage({
      role: 'user',
      content: 'x',
      metadata: { intent: 'release', action_success: true },
    });
    expect(r).toEqual({ role: 'user', content: 'x' });
  });
});
