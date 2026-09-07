const LIST_KEYS = new Set(['articles', 'stories', 'posts']);
type Item = Record<string, unknown>;
const object = (value: unknown): value is Item => value !== null && typeof value === 'object' && !Array.isArray(value);
const navigable = (value: unknown): value is Item => object(value)
  && ['apiUrl', 'permalink', 'id'].some(key => value[key] !== undefined);

/** Whole list records advance alongside images; unsupported fragments stay intact. */
export function sourceListPassages(sourceJson: string): string[] {
  const source: unknown = JSON.parse(sourceJson);
  if (!object(source) || 'contentWindow' in source) return [sourceJson];
  // Related records must not turn a story or discussion into a finite list view.
  if (['story', 'article', 'comments'].some(key => key in source)
    || (Array.isArray(source.blocks) && source.blocks.some(block => object(block)
      && Array.isArray(block.path) && ['story', 'article', 'comments'].includes(block.path[0])))) return [sourceJson];
  const rootKeys = Object.keys(source).filter(key => LIST_KEYS.has(key) && Array.isArray(source[key]) && (source[key] as unknown[]).length > 0);
  let records: Item[], render: (items: Item[]) => Item;
  if (rootKeys.length === 1) {
    const key = rootKeys[0], values = source[key] as unknown[];
    if (!values.every(navigable)) return [sourceJson];
    records = values;
    render = items => {
      const output = {...source, [key]: items};
      // Remove only redundant aggregate photos; preserve unrelated source metadata.
      if (Array.isArray(output.imageUrls) && output.imageUrls.every(url => records.some(record => record.imageUrl === url))) delete output.imageUrls;
      return output;
    };
  } else if (rootKeys.length === 0 && Array.isArray(source.blocks)) {
    const blocks = source.blocks;
    if (!blocks.every(block => object(block) && Array.isArray(block.path) && 'value' in block)) return [sourceJson];
    const listBlocks = blocks.filter(block => LIST_KEYS.has(block.path[0]));
    if (!listBlocks.length || new Set(listBlocks.map(block => block.path[0])).size !== 1) return [sourceJson];
    records = [];
    for (const block of listBlocks) {
      if (block.path.length === 1 && Array.isArray(block.value) && block.value.every(navigable)) {
        block.value.forEach((value: Item, index: number) => records.push({...block, path: [...block.path, index], value}));
      } else if (block.path.length === 2 && Number.isInteger(block.path[1]) && navigable(block.value)) records.push(block);
      else return [sourceJson]; // A partially split record must not lose fields.
    }
    const metadata = blocks.filter(block => !LIST_KEYS.has(block.path[0]));
    render = items => ({...source, blocks: [...metadata, ...items]});
  } else return [sourceJson];
  if (!records.length) return [sourceJson];
  const groups: Item[][] = [];
  let group: Item[] = [], chars = 0;
  for (const item of records) {
    const length = JSON.stringify(item).length;
    if (group.length && (group.length === 3 || chars + length > 1400)) {groups.push(group); group = []; chars = 0;}
    group.push(item); chars += length;
  }
  if (group.length) groups.push(group);
  return groups.map((items, cursor) => JSON.stringify({...render(items),
    contentWindow:{kind:'list', cursor, count:groups.length, hasMore:cursor + 1 < groups.length}}));
}
