function optionValue(args, name, fallback = null) {
  const prefix = `--${name}=`;
  const exactIndex = args.findIndex(value => value === `--${name}`);
  if (exactIndex >= 0) return args[exactIndex + 1] || fallback;
  const option = args.find(value => value.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

function isPositiveInteger(value) {
  if (!Number.isInteger(value)) return false;
  if (value < 1) return false;
  return true;
}

function invalidShard(value) {
  return new Error(`Invalid shard "${value}"; expected INDEX/COUNT such as 2/4.`);
}

function positiveShardPart(value, wholeShard) {
  const parsed = Number(value);
  if (!isPositiveInteger(parsed)) throw invalidShard(wholeShard);
  return parsed;
}

function assertShardRange(index, count, value) {
  if (index > count) throw invalidShard(value);
}

export function shardParts(value) {
  if (!value) return null;
  const parts = value.split('/');
  if (parts.length !== 2) throw invalidShard(value);
  const index = positiveShardPart(parts[0], value);
  const count = positiveShardPart(parts[1], value);
  assertShardRange(index, count, value);
  return { index, count };
}

export function parseRunnerOptions(args, timingsFallback = null) {
  return {
    group: optionValue(args, 'group', 'full'),
    singleSuite: optionValue(args, 'suite'),
    shard: shardParts(optionValue(args, 'shard')),
    timings: optionValue(args, 'timings', timingsFallback),
  };
}
