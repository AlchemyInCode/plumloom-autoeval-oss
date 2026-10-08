import packageMetadata from '../package.json' with { type: 'json' };

/** Package version reported by every Autoeval runtime entry point. */
export const CLI_VERSION = packageMetadata.version;
