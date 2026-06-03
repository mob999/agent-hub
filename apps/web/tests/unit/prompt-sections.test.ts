import { describe, expect, it } from 'vitest'

import { parsePromptSections } from '../../src/lib/promptSections'

describe('parsePromptSections', () => {
  it('parses multiple AgentHub XML-like blocks', () => {
    const sections = parsePromptSections([
      '<agenthub_agent_identity>',
      'You are coco.',
      '</agenthub_agent_identity>',
      '',
      '<agenthub_group_chat_protocol>',
      'Use send_message.',
      '</agenthub_group_chat_protocol>',
    ].join('\n'))

    expect(sections).toEqual([
      expect.objectContaining({
        kind: 'tag',
        tagName: 'agenthub_agent_identity',
        title: 'Agent identity',
        content: 'You are coco.',
      }),
      expect.objectContaining({
        kind: 'tag',
        tagName: 'agenthub_group_chat_protocol',
        title: 'Group chat protocol',
        content: 'Use send_message.',
      }),
    ])
  })

  it('keeps text around AgentHub blocks', () => {
    const sections = parsePromptSections([
      'Latest user message:',
      '<agenthub_agent_groups>',
      '#Design',
      '</agenthub_agent_groups>',
      'Please answer.',
    ].join('\n'))

    expect(sections.map((section) => section.title)).toEqual([
      'Prompt text',
      'Agent groups',
      'Prompt text',
    ])
    expect(sections[0]?.content).toBe('Latest user message:')
    expect(sections[2]?.content).toBe('Please answer.')
  })

  it('parses non-AgentHub prompt blocks used by run prompts', () => {
    const sections = parsePromptSections([
      '<conversation_history>',
      'User:\\nhello',
      '</conversation_history>',
      '<user_request>',
      'build this',
      '</user_request>',
      '<task_graph>',
      'Task #0 succeeded',
      '</task_graph>',
    ].join('\n'))

    expect(sections.map((section) => section.title)).toEqual([
      'Conversation history',
      'User request',
      'Task graph',
    ])
  })

  it('parses prompt blocks with attributes', () => {
    const sections = parsePromptSections([
      '<transcript file="memory/transcripts/2026-06-03.md" date="2026-06-03" truncated="false">',
      'User: hello',
      '</transcript>',
    ].join('\n'))

    expect(sections).toEqual([
      expect.objectContaining({
        kind: 'tag',
        tagName: 'transcript',
        title: 'Transcript',
        content: 'User: hello',
      }),
    ])
  })

  it('falls back to raw text for unclosed AgentHub tags', () => {
    const prompt = '<agenthub_agent_identity>\nYou are coco.'
    const sections = parsePromptSections(prompt)

    expect(sections).toEqual([
      expect.objectContaining({
        kind: 'raw',
        title: 'Prompt text',
        content: prompt,
      }),
    ])
  })

  it('returns a text section for prompts without AgentHub tags', () => {
    const sections = parsePromptSections('Plain prompt\nwith two lines.')

    expect(sections).toEqual([
      expect.objectContaining({
        kind: 'text',
        title: 'Prompt text',
        content: 'Plain prompt\nwith two lines.',
      }),
    ])
  })
})
