# AnimNode Scripting API Reference

此文档定义了 AnimNode 脚本系统的编程接口。AI 模型在生成脚本时应严格遵守此规范。

## 1. 运行环境 (Runtime Environment)

*   **语言**: JavaScript (ES6+)。
*   **执行模式**: 事务性 (Transactional)。整个脚本作为一个原子操作执行，生成单条历史记录。脚本执行过程中的状态变更对后续代码立即可见。
*   **沙箱**: 脚本运行在受限环境中，无 `window` / `document` 访问权限。
*   **入口**: 脚本按顺序执行，立即生效。

## 2. 坐标系与锚点 (Coordinates & Anchor Point)

*   **全局坐标**: 原点 `(0, 0)` 位于画布的 **左上角**。X 轴向右为正，Y 轴向下为正。
*   **锚点 (Anchor Point)**: 所有节点的 `x` 和 `y` 属性均指代其**局部坐标系的原点**，在视觉上对应**包围盒的左上角**。
    *   **矩形 (Rect)**: `(x, y)` 是矩形的左上角顶点。
    *   **圆形 (Circle)**: `(x, y)` 是圆**外接正方形的左上角**。圆心实际位于 `(x + radius, y + radius)`。
    *   **矢量 (Vector)**: `(x, y)` 是 SVG Path 数据中 `0,0` 点在画布上的位置。
*   **默认位置**: `addNode` 创建的新节点默认位于画布中心 (通常是 `400, 300`)。

---

## 3. 全局函数 (Global Functions)

在脚本的顶层作用域可直接访问以下函数：

### 核心操作

#### `addNode(type: string): NodeProxy`
创建并返回一个新的节点对象。
*   **参数**: `type` - 节点类型，可选值: `'rect'`, `'circle'`, `'vector'`。
*   **返回**: 节点的代理对象，可用于设置属性。
*   **默认层级**: 新建的节点会自动置于**最顶层** (Top Layer)。
*   **示例**: `const box = addNode('rect');`

#### `createVariable(initialValue: any): NodeProxy`
创建一个持久化的全局变量节点。
*   **参数**: `initialValue` - 初始值 (数字, 字符串, 颜色等)。
*   **说明**: 系统会自动使用声明的变量名作为节点 ID。**这是在表达式中共享数据的唯一方式**。
*   **示例**: `const SPEED = createVariable(100);`

#### `removeNode(id: string): void`
删除指定 ID 的节点。
*   **参数**: `id` - 目标节点的 ID。

#### `moveUp(nodeOrId: NodeProxy | string): void`
将节点向上移动一层（置于更上方）。
*   **参数**: 节点代理对象或节点 ID。
*   **说明**: 在左侧图层面板中，节点会向上移动一个位置。

#### `moveDown(nodeOrId: NodeProxy | string): void`
将节点向下移动一层（置于更下方）。
*   **参数**: 节点代理对象或节点 ID。
*   **说明**: 在左侧图层面板中，节点会向下移动一个位置。

#### `clear(): void`
清空当前项目中的所有节点。
*   **说明**: 建议在生成式脚本的开头调用此函数，以重置画布。

### 调试与日志

#### `log(...args: any[]): void`
输出普通信息到控制台面板。

#### `warn(...args: any[]): void`
输出警告信息。

#### `error(...args: any[]): void`
输出错误信息。

---

## 4. 节点对象属性 (Node Properties)

所有通过 `addNode` 或 `createVariable` 返回的对象都支持以下属性。

### 通用属性 (Base Properties)
所有可视节点 (`rect`, `circle`, `vector`) 都具备的属性。

| 属性名 | 类型 | 读/写 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `string` | RW | Unique ID | 节点的唯一标识符。修改此属性会重命名节点。 |
| `x` | `number` | RW | 400 | **左上角** X 轴位置 (px)。 |
| `y` | `number` | RW | 300 | **左上角** Y 轴位置 (px)。 |
| `rotation` | `number` | RW | 0 | 旋转角度 (度)。 |
| `scale` | `number` | RW | 1 | 缩放比例。 |
| `opacity` | `number` | RW | 1 | 不透明度 (0-1)。 |
| `fill` | `color` | RW | #ffffff | 填充颜色 (Hex, RGB, 或 CSS 颜色名)。 |

### 矩形 (Rect)
类型: `'rect'`

| 属性名 | 类型 | 读/写 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `width` | `number` | RW | 100 | 宽度。 |
| `height` | `number` | RW | 100 | 高度。 |
| `stroke` | `color` | RW | transparent | 描边颜色。 |
| `strokeWidth` | `number` | RW | 0 | 描边宽度。 |
| `path` | `string` | Read | Computed | (只读) 自动计算的矩形路径。 |

### 圆形 (Circle)
类型: `'circle'`

| 属性名 | 类型 | 读/写 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `radius` | `number` | RW | 50 | 半径。 |
| `stroke` | `color` | RW | transparent | 描边颜色。 |
| `strokeWidth` | `number` | RW | 0 | 描边宽度。 |
| `path` | `string` | Read | Computed | (只读) 自动计算的圆形路径。 |

### 矢量路径 (Vector)
类型: `'vector'`

| 属性名 | 类型 | 读/写 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `path` | `string` | RW | "" | **SVG Path Data 字符串** (例如 "M 0 0 L 10 10 Z")。 |
| `stroke` | `color` | RW | #10b981 | 描边颜色。 |
| `strokeWidth` | `number` | RW | 2 | 描边宽度。 |

### 变量 (Variable)
类型: `'value'`

| 属性名 | 类型 | 读/写 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `value` | `any` | RW | 0 | 变量存储的值。 |

---

## 5. 赋值与表达式 (Assignments & Expressions)

AnimNode 支持两种属性赋值模式。请特别注意**动态表达式的作用域限制**。

### A. 静态赋值 (Static Assignment)
在脚本执行时计算一次数值。可以使用脚本中的任何局部变量。

```javascript
const gap = 10;
// 计算结果 20 被赋值给 x。后续 gap 变化不会影响 x。
node.x = gap * 2; 
```

### B. 表达式赋值 (Expression Assignment)
赋值一个箭头函数 `() => ...`，用于创建随时间或状态变化的动画。

#### ⚠️ 关键规则：作用域限制
由于表达式是在脚本运行结束后、在每一帧渲染时独立执行的，因此：
1.  **不能**引用脚本中的普通局部变量（`const`, `let` 等）。
2.  **必须**使用 `createVariable` 来创建需要在表达式中引用的全局数据。
3.  **必须**使用 `ctx.get('id', 'prop')` 来引用其他节点。

#### 示例
```javascript
// ❌ 错误示范
const speed = 5; 
// 运行时报错: "speed is not defined"
node.x = () => t * speed; 

// ✅ 正确示范 1: 使用 createVariable
const SPEED = createVariable(5); 
node.x = () => t * SPEED; 

// ✅ 正确示范 2: 引用其他节点
const box = addNode('rect');
box.id = "leader";
// 必须用 ctx.get，不能直接写 leader.x
node.x = () => ctx.get('leader', 'x') + 20;
```

#### 表达式内可用变量
在箭头函数内部，只有以下变量是可用的：
*   `t`: 全局时间 (秒)。
*   `val`: 该属性当前的静态值。
*   `ctx`: 上下文对象。
    *   `ctx.get(nodeId, propKey)`: 获取任意节点属性值。
    *   `ctx.audio.bass`: 低频音量 (0-1)。
*   `Math`: JavaScript 标准数学库。
*   **全局变量节点 ID**: 通过 `createVariable` 创建的变量名。

---

## 6. 常用代码片段 (Snippets)

### 初始化
```javascript
clear(); // 始终建议先清空
const CENTER_X = createVariable(400);
const CENTER_Y = createVariable(300);
```

### 创建时钟刻度 (展示旋转与定位)
```javascript
const count = 12;
const r = 150;

for(let i = 0; i < count; i++) {
    const mark = addNode('rect');
    mark.width = 4;
    mark.height = 20;
    
    const angle = (i / count) * Math.PI * 2;
    
    // 静态计算：因为位置固定，不需要用表达式
    // 注意：x, y 是左上角，如果要居中需要减去宽高的一半
    mark.x = 400 + Math.sin(angle) * r - mark.width / 2;
    mark.y = 300 - Math.cos(angle) * r - mark.height / 2;
    
    mark.rotation = i * (360 / count);
}
```

### 动态波形 (Vector Path)
```javascript
const wave = addNode('vector');
wave.stroke = "#3b82f6";
wave.strokeWidth = 4;

// 动态 Path：必须放在箭头函数中
wave.path = () => {
    let d = "M 0 300";
    // 在表达式内部无法访问脚本的循环变量 i，除非它是硬编码的数字
    // 或者将数据存储在 'value' 类型的节点数组中
    for(let x=0; x<=800; x+=20) {
        const y = 300 + Math.sin(t * 5 + x * 0.02) * 100;
        d += ` L ${x} ${y}`;
    }
    return d;
};
```