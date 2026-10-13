/**
 * Text on an opaque calendar colour — DP-145. Canonical calendar colours are
 * six-digit hex (domain validation); never rewrite the stored colour to make
 * white text work. Black or white, whichever has the stronger WCAG contrast,
 * always clears 4.5:1 on an opaque RGB background.
 */
export function calendarTextColor(background: string): '#000000' | '#ffffff' {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(background.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
}
