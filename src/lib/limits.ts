import { config } from '../pdfmango.config';

const MB = 1024 * 1024;

/** The bits of `navigator`/`window` that decide the device class; injectable for tests. */
export type DeviceEnv = {
  userAgentDataMobile?: boolean;
  coarseNoHover?: boolean;
  deviceMemoryGB?: number;
};

export function readDeviceEnv(): DeviceEnv {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean }; deviceMemory?: number };
  return {
    userAgentDataMobile: nav.userAgentData?.mobile,
    coarseNoHover: typeof matchMedia === 'function' ? matchMedia('(pointer: coarse) and (hover: none)').matches : false,
    deviceMemoryGB: nav.deviceMemory,
  };
}

/** Phones and tablets: UA-CH says mobile, or the primary pointer is coarse with no hover. */
export function isMobile(env: DeviceEnv): boolean {
  return env.userAgentDataMobile === true || env.coarseNoHover === true;
}

export type SizeLimit = { maxBytes: number; maxMB: number; mobile: boolean };

/** Phones get the small limit; so does any device reporting 4 GB of memory or less. */
export function sizeLimit(env: DeviceEnv): SizeLimit {
  const mobile = isMobile(env);
  const lowMemory = env.deviceMemoryGB !== undefined && env.deviceMemoryGB <= 4;
  const maxMB = mobile || lowMemory ? config.limits.mobileMaxMB : config.limits.desktopMaxMB;
  return { maxBytes: maxMB * MB, maxMB, mobile };
}

/** Returns a friendly refusal, or null when the file fits the session's size budget. */
export function checkSize(limit: SizeLimit, usedBytes: number, fileBytes: number): string | null {
  if (usedBytes + fileBytes <= limit.maxBytes) return null;
  const where = limit.mobile ? 'on phones and tablets' : 'on this device';
  const tip = limit.mobile ? ' Larger files work on a computer.' : '';
  return `That would take the total past ${limit.maxMB} MB, the limit ${where}.${tip}`;
}

/** Returns a friendly refusal, or null when the pages fit under the page limit. */
export function checkPages(usedPages: number, addPages: number, maxPages: number = config.limits.maxPages): string | null {
  if (usedPages + addPages <= maxPages) return null;
  return `PDFMango works with up to ${maxPages.toLocaleString('en-US')} pages at a time; this file would take the total to ${(usedPages + addPages).toLocaleString('en-US')}.`;
}
