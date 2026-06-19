import type { GameDefinition } from './types';

export const gameRegistry: GameDefinition[] = [
  {
    id: 'hand-particle-lab',
    title: 'Hand Particle Lab',
    eyebrow: '手势粒子实验室',
    summary: '用摄像头识别双手关键点，在深色空间中生成柔和发光骨架和手势残影。',
    status: 'available',
    accent: 'cyan',
    gestures: ['双手追踪', '发光骨架', '柔和残影'],
  },
  {
    id: 'void-slasher',
    title: 'Void Slasher',
    eyebrow: '虚空碎影',
    summary: '挥动手势光刃，切碎漂浮在虚空中的玻璃晶体。',
    status: 'available',
    accent: 'violet',
    gestures: ['Gesture', 'Three.js', 'Slasher', 'Particles'],
  },
  {
    id: 'quantum-ripple',
    title: 'Quantum Ripple',
    eyebrow: '量子波纹',
    summary: '移动手掌抬起赛博蜂窝网格，接住坠落的数据异常球，握拳释放扩散冲击波。',
    status: 'available',
    accent: 'cyan',
    gestures: ['Shader', 'InstancedMesh', 'Ripple', 'Score'],
  },
  {
    id: 'particle-saturn',
    title: 'Particle Saturn',
    eyebrow: '粒子土星',
    summary: '参考粒子土星项目：用拇指和食指距离缩放土星，用手掌位置控制星环视角。',
    status: 'available',
    accent: 'violet',
    gestures: ['缩放', '俯仰', 'Y轴旋转'],
  },
  // Sword Array 源码保留在 src/games/sword-array/，当前先从网站入口下线。
  // {
  //   id: 'sword-array',
  //   title: 'Sword Array',
  //   eyebrow: '青竹蜂云剑阵',
  //   summary: '复刻参考资料中的手势剑阵：剑指游龙、张掌莲花、握拳护盾、特殊手势触发大庚阵。',
  //   status: 'available',
  //   accent: 'amber',
  //   gestures: ['游龙', '莲花', '护盾', '大庚阵'],
  // },
  {
    id: 'repulsion-orb',
    title: 'Repulsion Orb',
    eyebrow: '排斥球场',
    summary: '参考 gesture-lab 排斥球玩法：红黑小球团簇，右手握拳排斥，左手捏合抓取单个小球。',
    status: 'available',
    accent: 'magenta',
    gestures: ['右手排斥', '左手抓取', '团簇回流'],
  },
];

export function getGameDefinition(id: string): GameDefinition | undefined {
  return gameRegistry.find((game) => game.id === id);
}
