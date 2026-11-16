export function contrastRatio(first: string, second: string): number {
  function luminance(color: string): number {
    const channels = color.match(/\d+/g)?.map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Expected an opaque RGB color: ${color}`);
    return channels.reduce((total, channel, index) => {
      const value = channel / 255;
      const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      return total + linear * (index === 0 ? 0.2126 : index === 1 ? 0.7152 : 0.0722);
    }, 0);
  }
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}
