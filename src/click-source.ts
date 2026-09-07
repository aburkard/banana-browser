// Use only for recognized, processed providers whose imageUrl/imageUrls fields
// contain reference-image resources, not navigation. Rendering keeps the original.
export function compactClickSource(sourceJson: string): string {
  let changed = false;
  const compact = JSON.stringify(JSON.parse(sourceJson), (key, value) => {
    if (key === 'imageUrl' || key === 'imageUrls') {
      changed = true;
      return undefined;
    }
    return value;
  });
  return changed ? compact : sourceJson;
}
