# AnimNode Scripting API Reference

此文档定义了 AnimNode 脚本系统的编程接口。AI 模型在生成脚本时应严格遵守此规范。

## 1. 运行环境 (Runtime Environment)

*   **语言**: JavaScript (ES6+)。
*   **执行模式**: 原子化 (Atomic)。整个脚本作为一个事务执行，生成单条历史记录。
*   **沙箱**: 脚本运行在受限环境中，无 `window` / `document` 访问权限。
*   **入口**: 脚本按顺序执行，立即生效。

---

## 2. 全局函数与变量 (Global Context)

在脚本的顶层作用域可直接访问以下对象：

### 核心函数
| 函数签名 | 返回值 | 描述 |
| :--- | :--- | :--- |
| `addNode(type: string)` | `NodeProxy` | 创建新节点。`type` 可选值: `'rect'`, `'circle'`, `'vector'`。 |
| `removeNode(id: string)` | `void` | 删除指定 ID 的节点。 |
| `clear()` | `void` | **重要**: 清空当前画布上的所有节点。建议在生成式脚本开头调用。 |
| `log(...args)` | `void` | 输出信息到控制台。 |
| `warn(...args)` | `void` | 输出警告。 |
| `error(...args)` | `void` | 输出错误。 |

### 内置对象
*   `Math`: 标准 JS Math 对象。
*   `Date`: 标准 JS Date 对象。
*   **节点 ID**: 场景中已存在的所有节点 ID 都会自动注册为全局变量 (例如 `rect_0`, `sun`)。

---

## 3. 节点对象 (Node Proxy)

`addNode` 返回的对象或通过 ID 访问的全局对象。

### 元数据属性 (Metadata)
| 属性 | 类型 | 读/写 | 描述 |
| :--- | :--- | :--- | :--- |
| `.id` | `string` | RW | 节点的唯一标识符。修改此属性会重命名节点。**必须唯一**。 |
| `.name` | `string` | RW | 在 UI 图层面板中显示的名称。 |
| `.type` | `string` | Read | 节点类型 (`rect`, `circle`, `vector`)。 |

### 视觉属性 (Visual Properties)
所有节点通用的变换和外观属性。

| 属性名 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `x` | `number` | 0 | X 轴位置 (中心点)。 |
| `y` | `number` | 0 | Y 轴位置 (中心点)。 |
| `rotation` | `number` | 0 | 旋转角度 (度)。 |
| `scale` | `number` | 1 | 缩放比例。 |
| `opacity` | `number` | 1 | 不透明度 (0-1)。 |
| `fill` | `color` | `#ffffff` | 填充颜色 (Hex 或 CSS string)。 |

### 形状特有属性 (Shape Specific)

**Type: 'rect'**
| 属性名 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `width` | `number` | 100 | 宽度。 |
| `height` | `number` | 100 | 高度。 |

**Type: 'circle'**
| 属性名 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `radius` | `number` | 50 | 半径。 |

**Type: 'vector'**
| 属性名 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `d` | `string` | `""` | SVG Path Data 字符串 (e.g. "M 0 0 L 10 10 Z")。 |
| `stroke` | `color` | `none` | 描边颜色。 |
| `strokeWidth`| `number` | 0 | 描边宽度。 |

---

## 4. 赋值语法规则 (Assignment Rules)

AnimNode 支持两种属性赋值模式。AI 应根据需求选择模式。

### 模式 A: 静态赋值 (Static Assignment)
设置一个固定的常数值。
```javascript
node.x = 100;
node.fill = "#ff0000";
node.id = "myNode";
```

### 模式 B: 表达式赋值 (Expression Assignment)
设置一个随时间变化的动画逻辑。
**语法**: 必须赋值一个 **箭头函数 (Arrow Function)**。

```javascript
// 正确写法
node.x = () => Math.sin(t) * 100;

// 错误写法 (这只是赋值了计算结果的静态值)
node.x = Math.sin(t) * 100; 
```

### 表达式内部环境
在箭头函数 `() => { ... }` 内部，可访问以下特殊变量：

1.  **`t`** (`number`): 全局时间，单位为秒。
2.  **`val`** (`any`): 该属性当前的静态基准值。
3.  **`ctx`** (`object`): 上下文工具对象。

---

## 5. 上下文工具 (Context API)

在表达式内部用于获取外部数据。

### 获取其他节点数据
`ctx.get(nodeId: string, property: string): number | string`

用于实现父子跟随、约束等效果。
```javascript
// 让 B 跟随 A
nodeB.x = () => ctx.get('nodeA', 'x') + 50;
```

### 音频响应 (Audio Reactive)
`ctx.audio`: 包含当前帧的频谱分析数据。
*   `ctx.audio.bass` (0-1): 低频能量
*   `ctx.audio.mid` (0-1): 中频能量
*   `ctx.audio.treble` (0-1): 高频能量

```javascript
// 随低音缩放
node.scale = () => 1 + ctx.audio.bass * 2;
```

---

## 6. 代码生成示例 (Examples)

### 场景初始化模板
```javascript
clear(); // 1. 清理
const bg = addNode('rect'); // 2. 创建
bg.width = 800;
bg.height = 600;
bg.fill = "#111";
```

### 复杂动画逻辑
```javascript
const ball = addNode('circle');
// 使用逻辑判断
ball.fill = () => {
    if (Math.sin(t) > 0) return "#ff0000";
    return "#0000ff";
};
// 复杂运动轨迹
ball.x = () => Math.sin(t) * 100 + Math.cos(t * 3) * 20;
```

### 批量生成 (Grid System)
```javascript
clear();
const count = 5;
for(let i=0; i<count; i++) {
    const n = addNode('rect');
    n.x = (i - count/2) * 50;
    // 每个节点有独立的相位偏移
    n.y = () => Math.sin(t + i) * 50; 
}
```

---

## 7. 安全沙箱与限制 (Sandbox & Limitations)

为了保证动画渲染的确定性和安全性，脚本和表达式运行在隔离的沙箱中。

### 允许使用的全局对象 (Allowed Globals)
仅以下 JavaScript 标准对象可用：
*   `Math` (e.g. `Math.sin`, `Math.random`)
*   `Date`
*   `Array` (e.g. `.map`, `.filter`)
*   `Object`, `String`, `Number`, `Boolean`
*   `JSON`
*   `RegExp`
*   `parseInt`, `parseFloat`, `isNaN`, `isFinite`
*   `console` (输出重定向到应用内控制台)

### 禁止使用的 API (Forbidden APIs)
以下 API **不可用**，尝试访问将返回 `undefined` 或抛出错误：
*   ❌ **DOM API**: `window`, `document`, `HTMLElement`, `alert` 等。
*   ❌ **网络请求**: `fetch`, `XMLHttpRequest`。
*   ❌ **定时器**: `setTimeout`, `setInterval` (动画驱动应完全依赖 `t` 变量)。
*   ❌ **本地存储**: `localStorage`, `sessionStorage`.
*   ❌ **动态执行**: `eval`, `new Function` (但在控制台顶层脚本中可以使用 `new Function`，属性表达式中禁用)。

### 设计原则
*   **纯函数**: 表达式应为关于时间 `t` 的纯函数。给定相同的 `t`，应始终返回相同的结果。
*   **无副作用**: 表达式不应修改外部状态（如设置其他节点的属性），只能返回当前属性的值。要修改其他节点，请使用控制台脚本一次性执行，而不是在每帧的表达式中执行。