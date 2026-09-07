export function advancingBuildOptions(args) {
  const targets=args.filter(arg=>arg.startsWith('--target='));
  if(targets.length>1)throw new Error('Pass one target size');
  const explicit=targets[0]?.slice('--target='.length);
  if(explicit!==undefined&&!['1000','1400','2200'].includes(explicit))throw new Error('Sizing target must be 1000, 1400, or 2200');
  const targetChars=explicit===undefined?1400:Number(explicit),sizing=explicit!==undefined;
  return {
    targetChars,sizing,maxImages:sizing?5:3,
    directory:sizing?`advancing-article-${targetChars}`:'advancing-article-check',
    lock:sizing?`banana-advancing-size-v1-${targetChars}`:'banana-advancing-article-v1',
  };
}
