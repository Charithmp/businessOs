import { BadRequestException } from '@nestjs/common';

export type ComponentTree = { type: 'Page'; children: ComponentNode[]; metadata?: { title?: string; description?: string } };
export type ComponentNode = { id: string; type: 'Hero' | 'Text' | 'Image' | 'Button' | 'Section' | 'Columns'; props?: Record<string, string | number | boolean>; children?: ComponentNode[] };
const allowed = new Set<ComponentNode['type']>(['Hero', 'Text', 'Image', 'Button', 'Section', 'Columns']);

/** Prevent arbitrary HTML or executable code from entering the canonical site representation. */
export function assertSafeComponentTree(value: unknown): asserts value is ComponentTree {
  if (!value || typeof value !== 'object' || (value as { type?: string }).type !== 'Page' || !Array.isArray((value as { children?: unknown }).children)) {
    throw new BadRequestException('A website version must be a Page component tree');
  }
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') throw new BadRequestException('Invalid component node');
    const candidate = node as { id?: unknown; type?: unknown; props?: unknown; children?: unknown };
    if (typeof candidate.id !== 'string' || !allowed.has(candidate.type as ComponentNode['type'])) throw new BadRequestException('Unsupported component type');
    if (candidate.props && (typeof candidate.props !== 'object' || Array.isArray(candidate.props))) throw new BadRequestException('Component props must be plain values');
    if (Array.isArray(candidate.children)) candidate.children.forEach(visit);
  };
  (value as { children: unknown[] }).children.forEach(visit);
}
