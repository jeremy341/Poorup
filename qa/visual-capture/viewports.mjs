import { devices } from '@playwright/test';

const desktopDevice = devices['Desktop Chrome'];
const miniIpad = devices['iPad Mini landscape'];
const gen7Ipad = devices['iPad (gen 7) landscape'];
const gen11Ipad = devices['iPad (gen 11) landscape'];
const proIpad = devices['iPad Pro 11 landscape'];

function createProfile(id, width, height, {
  group = 'desktop',
  device = desktopDevice,
  aliases = [],
  isMobile = false,
  hasTouch = false,
  supported = true,
} = {}) {
  return {
    id,
    group,
    width,
    height,
    deviceScaleFactor: device.deviceScaleFactor || 1,
    isMobile,
    hasTouch,
    orientation: 'landscape',
    aliases,
    supported,
    device,
  };
}

const desktopProfile = (id, width, height, aliases = []) => createProfile(id, width, height, { aliases });
const ipadProfile = (id, width, height, device, aliases = []) => createProfile(id, width, height, {
  group: 'ipad', device, aliases, isMobile: true, hasTouch: true,
});

export const supportedViewports = Object.freeze([
  desktopProfile('desktop-1440x900', 1440, 900),
  desktopProfile('desktop-1536x900', 1536, 900),
  desktopProfile('desktop-1600x900', 1600, 900),
  desktopProfile('desktop-1920x1080', 1920, 1080),
  desktopProfile('desktop-2560x1440', 2560, 1440),
  desktopProfile('desktop-3840x2160', 3840, 2160, ['4k']),
  ipadProfile('ipad-944x656', 944, 656, gen11Ipad, ['iPad (gen 11) landscape']),
  ipadProfile('ipad-1024x768', 1024, 768, miniIpad, [
    'iPad (gen 5) landscape',
    'iPad (gen 6) landscape',
    'iPad Mini landscape',
  ]),
  ipadProfile('ipad-1080x810', 1080, 810, gen7Ipad, ['iPad (gen 7) landscape']),
  ipadProfile('ipad-1180x820', 1180, 820, proIpad, ['additional Air-sized profile']),
  ipadProfile('ipad-1194x834', 1194, 834, proIpad, ['iPad Pro 11 landscape']),
  ipadProfile('ipad-1366x1024', 1366, 1024, proIpad, ['additional large-iPad profile']),
]);

function parseCustomViewport(value) {
  const match = /^(\d+)x(\d+)$/i.exec(value || '');
  if (!match) throw new Error('Custom viewport must use WIDTHxHEIGHT, such as 1920x1080.');

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width <= 0 || height <= 0) throw new Error('Custom viewport dimensions must be positive.');
  if (height > width) throw new Error('Custom capture viewports must be landscape.');

  return {
    ...createProfile(`custom-${width}x${height}`, width, height, { aliases: ['one-off viewport'] }),
    group: 'custom',
    supported: false,
  };
}

function parseViewportOption(value, options) {
  const isSupported = supportedViewports.some(profile => profile.id === value || `${profile.width}x${profile.height}` === value);
  if (!isSupported) parseCustomViewport(value);
  options.viewport = value;
}

const optionHandlers = {
  group(value, options) { options.group = value; },
  viewport: parseViewportOption,
  'output-dir'(value, options) { options.outputDir = value; },
};

function parseNamedOption(argument, options) {
  const separator = argument.indexOf('=');
  if (!argument.startsWith('--') || separator < 3) throw new Error(`Unknown option: ${argument}`);

  const name = argument.slice(2, separator);
  const value = argument.slice(separator + 1).trim();
  if (!value) throw new Error(`Missing value for --${name}.`);

  const handler = optionHandlers[name];
  if (!handler) throw new Error(`Unknown option: ${argument}`);
  handler(value, options);
}

function parseFlag(argument, options) {
  if (argument === '--list') {
    options.list = true;
    return true;
  }
  if (argument === '--help' || argument === '-h') {
    options.help = true;
    return true;
  }
  return false;
}

export function parseCaptureArgs(argv) {
  const options = { group: 'all', viewport: null, outputDir: null, list: false };
  for (const argument of argv) {
    if (!parseFlag(argument, options)) parseNamedOption(argument, options);
  }
  return options;
}

export function selectViewports(options = {}) {
  if (!options.viewport) return [...supportedViewports];

  const match = supportedViewports.find(profile => profile.id === options.viewport
    || `${profile.width}x${profile.height}` === options.viewport);
  if (match) return [match];
  if (/^\d+x\d+$/i.test(options.viewport)) return [parseCustomViewport(options.viewport)];
  throw new Error(`Unknown viewport: ${options.viewport}`);
}

export function selectViewportsById(profileIds) {
  const ids = new Set(profileIds);
  const selected = supportedViewports.filter(profile => ids.has(profile.id));
  if (selected.length !== ids.size) {
    const unknown = [...ids].filter(id => !supportedViewports.some(profile => profile.id === id));
    throw new Error(`Unknown supported viewport profile: ${unknown.join(', ')}`);
  }
  return selected;
}

export function playwrightUse(profile) {
  return {
    ...profile.device,
    browserName: 'chromium',
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    viewport: { width: profile.width, height: profile.height },
  };
}
