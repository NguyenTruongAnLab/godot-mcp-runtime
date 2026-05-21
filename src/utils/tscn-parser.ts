export interface TscnSection {
  header: string; // raw header line, e.g. [node name="Foo" type="Node2D" parent="."]
  attrs: Record<string, string>; // parsed header attributes
  props: string[]; // raw property lines
}

export interface TscnScene {
  sections: TscnSection[];
}

/**
 * Parse key="value" pairs from a header line like [node name="Foo" type="Node2D"].
 */
export function parseHeaderAttrs(header: string): Record<string, string> {
  const inner = header.slice(1, -1); // strip [ ]
  const attrs: Record<string, string> = {};
  // Match: key="value" or key=value
  const re = /(\w+)=(?:"([^"]*)"|([\w.:/+-]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  // Also grab the section type (first word)
  const firstWord = inner.match(/^(\w+)/);
  if (firstWord) attrs['_type'] = firstWord[1];
  return attrs;
}

/**
 * Parse a .tscn text into structured sections.
 */
export function parseTscn(text: string): TscnScene {
  const lines = text.split(/\r?\n/);
  const sections: TscnSection[] = [];
  let current: TscnSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (current) sections.push(current);
      current = {
        header: trimmed,
        attrs: parseHeaderAttrs(trimmed),
        props: [],
      };
    } else if (current && trimmed !== '') {
      current.props.push(line);
    }
  }
  if (current) sections.push(current);

  return { sections };
}

/**
 * Serialize a parsed scene back to text.
 */
export function serializeTscn(scene: TscnScene): string {
  const parts: string[] = [];
  for (const section of scene.sections) {
    parts.push(section.header);
    if (section.props.length > 0) {
      parts.push(...section.props);
    }
    parts.push('');
  }
  return parts.join('\n');
}

// Attributes that Godot always expects to be quoted strings.
const QUOTED_ATTRS = new Set(['name', 'type', 'parent', 'path', 'groups']);

/**
 * Build a header string from a section type and attributes.
 */
export function buildHeader(type: string, attrs: Record<string, string | undefined>): string {
  let header = `[${type}`;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === '_type' || v === undefined) continue;
    // Always quote string-valued attrs; leave bare numeric/keyword values unquoted
    if (QUOTED_ATTRS.has(k) || /[^a-zA-Z0-9_.:/+-]/.test(v)) {
      header += ` ${k}="${v}"`;
    } else {
      header += ` ${k}=${v}`;
    }
  }
  header += ']';
  return header;
}

/**
 * Create a minimal new Godot 3.x GLES2 scene text with the given root node type.
 */
export function createMinimalTscnText(rootNodeType: string): string {
  return [
    '[gd_scene format=2]',
    '',
    `[node name="${rootNodeType}" type="${rootNodeType}"]`,
    '',
  ].join('\n');
}

/**
 * Find a node section by its Godot scene path (e.g. "." or "Player/Sprite2D").
 */
export function findNodeSection(
  scene: TscnScene,
  nodePath: string
): TscnSection | undefined {
  for (const section of scene.sections) {
    if (section.attrs['_type'] !== 'node') continue;
    const resolved = resolveNodePath(scene, section);
    if (resolved === nodePath) return section;
  }
  return undefined;
}

/**
 * Compute the full scene path of a node section (e.g. "Player/Sprite2D").
 * The root node has path ".".
 */
export function resolveNodePath(scene: TscnScene, section: TscnSection): string {
  const name = section.attrs['name'] ?? '';
  const parent = section.attrs['parent'];
  if (parent === undefined) return '.'; // root
  if (parent === '.') return name;
  return `${parent}/${name}`;
}
