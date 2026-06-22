# Tetris 游戏及其 AI 算法课程设计

本项目实现了课题三要求的核心内容：

- HTML5 Canvas 俄罗斯方块游戏界面；
- 键盘控制：左右移动、旋转、加速、硬降；
- 得分、消行、等级和方块数统计；
- 人类玩家模式、AI 算法模式；
- JSON 格式 WebSocket AI 接口；
- 200 局自动评测，统计平均消行、最高、最低和标准差；
- 游戏逻辑、渲染层、AI 决策层、通信层解耦。

## 运行方式

在项目目录运行：

```bash
npm run start
```

浏览器打开：

```text
http://127.0.0.1:5173
```

如果要展示 Python WebSocket AI 服务，另开一个终端：

```bash
npm run ai
```

然后在网页中选择 `AI 算法模式（WebSocket）`，点击 `连接 AI 服务`。如果 AI 服务已启动，右上角会显示 `WS 已连接`。

网页评测只能在 AI 算法模式下运行。200 局评测是独立的批量仿真实验，不使用页面中间正在显示的那一局；这样可以快速统计平均消行数。评测默认使用 1 层启发式搜索，每局最多 3000 个方块。该预算用于快速验证“平均消除 1000 行”的课题目标；若预算结束时游戏仍未结束，说明 AI 还可以继续运行。评测运行时按钮会变成 `停止评测`，中途停止的未完成局不会计入统计。

## AI 接口

游戏发送给 AI：

```json
{
  "type": "state",
  "seq": 1,
  "width": 10,
  "height": 20,
  "board": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  "current": { "type": "T", "x": 3, "y": -2, "rotation": 0 },
  "next": ["I", "O", "L"],
  "score": 1200,
  "lines": 36,
  "depth": 2
}
```

AI 返回：

```json
{
  "type": "move",
  "seq": 1,
  "x": 4,
  "y": 16,
  "rotation": 1,
  "eval": -42.18,
  "actions": ["rotateCW", "right", "hardDrop"]
}
```

## AI 算法说明

AI 使用启发式搜索：

1. 枚举当前方块所有旋转状态和所有合法落点；
2. 对每个落点模拟放置、消行；
3. 提取棋盘特征；
4. 使用线性评估函数打分；
5. 可选向前看下一块方块，选择综合评分最高的动作。

评估特征包括：

- `landingHeight`：落点高度；
- `erodedPieceCells`：被消行吞掉的当前方块格数；
- `aggregateHeight`：总高度；
- `completeLines`：本步消除行数；
- `holes`：空洞数；
- `bumpiness`：表面崎岖度；
- `wells`：井深；
- `rowTransitions`：行变化次数；
- `columnTransitions`：列变化次数；
- `maxHeight`：最高列高度。

## 分工建议

- 成员 A：`src/tetrisCore.js`，负责游戏核心逻辑、碰撞、旋转、消行、计分；
- 成员 B：`src/main.js`、`src/renderer.js`、`src/styles.css`，负责界面、交互、可视化；
- 成员 C：`src/ai.js`、`ai_server.py`，负责 AI 搜索、WebSocket 服务、200 局评测和实验分析。

## 验证

运行快速冒烟测试：

```bash
npm run test
```

答辩时建议展示顺序：

1. 人类模式手动操作；
2. 内置 AI 自动玩；
3. 启动 Python 服务，切换 WebSocket AI；
4. 运行 200 局评测；
5. 展示 AI 决策面板和导出的对局记录。
