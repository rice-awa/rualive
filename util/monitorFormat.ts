/**
 * HTTP 监控区 动森配色工具（对应原 util/color.ts，但换用动森色板）。
 * darker=true 用于文字（墨绿/焦橙/砖红），false 用于条带填充（更亮的同色系）。
 */
export function monitorColor(percent: number | string, darker: boolean): string {
  percent = Number(percent)
  if (Number.isNaN(percent)) return darker ? '#8a7a64' : '#cfc2a6'
  if (percent >= 99.9) return darker ? '#4d7f4a' : '#8fb94e'
  if (percent >= 99) return darker ? '#6f9c4a' : '#afd46a'
  if (percent >= 95) return darker ? '#c97f1e' : '#f0a852'
  return darker ? '#c05a4b' : '#e07b6a'
}

/** 维护提醒的 Mantine 语义色（'yellow' | 'blue' | 'gray' ...）映射到动森色 */
export function maintenanceColor(color?: string): string {
  switch (color) {
    case 'yellow':
      return '#d9b95f'
    case 'blue':
      return '#7fb6d4'
    case 'green':
      return '#8fb94e'
    case 'red':
      return '#e07b6a'
    case 'orange':
      return '#f0a852'
    case 'gray':
    case 'grey':
      return '#cfc2a6'
    case 'pink':
      return '#f2a9a2'
    case 'violet':
    case 'grape':
      return '#c9a6e8'
    default:
      return '#d9b95f'
  }
}
