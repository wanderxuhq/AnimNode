
# AnimNode Scripting API Reference

此文档定义了 AnimNode 脚本系统的编程接口。AI 模型在生成脚本时应严格遵守此规范。

## 1. 运行环境 (Runtime Environment)

*   **语言**: JavaScript (ES6+)。
*   **执行模式**: 事务性 (Transactional)。整个脚本作为一个原子操作执行，生成单条历史记录。
    *   **即时性**: 脚本执行过程中，`addNode` 或 `set` 操作后的状态更新对后续代码**立即可见**（例如，`addNode` 后立即修改其属性是安全的）。
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
*   **默认层级**: 新建的节点会自动置于**最顶层** (即图层列表的第一个位置，Index 0)。
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
将节点向上移动一层（视觉上更靠前，即图层列表 Index 减小）。
*   **参数**: 节点代理对象或节点 ID。

#### `moveDown(nodeOrId: NodeProxy | string): void`
将节点向下移动一层（视觉上更靠后，即图层列表 Index 增加）。
*   **参数**: 节点代理对象或节点 ID。

#### `addKeyframe(nodeOrId: any, prop: string, value: any, time?: number): void`
为指定属性添加关键帧。如果属性当前是表达式模式，此操作会将其转换为关键帧动画模式。
*   **参数**:
    *   `nodeOrId`: 节点对象或 ID。
    *   `prop`: 属性名 (如 `'x'`, `'opacity'`)。
    *   `value`: 关键帧的值。
    *   `time`: (可选) 时间点秒数。如果不传，默认为当前播放头时间。
*   **示例**: `addKeyframe(box, 'x', 500, 2.0);`

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

## 4. 绘图 API (Path Builder)

为了避免手动拼接 SVG 字符串，您可以使用 `Path` 类来构建矢量形状。此功能在脚本和表达式中均可用。

#### `new Path()`
创建一个新的路径构建器。

#### 方法:
*   `moveTo(x, y)`: 移动画笔。
*   `lineTo(x, y)`: 绘制直线。
*   `quadraticCurveTo(cx, cy, x, y)`: 二次贝塞尔曲线。
*   `bezierCurveTo(c1x, c1y, c2x, c2y, x, y)`: 三次贝塞尔曲线。
*   `close()`: 闭合路径。
*   `rect(x, y, w, h)`: 绘制矩形。
*   `circle(cx, cy, r)`: 绘制圆形。
*   `ellipse(cx, cy, rx, ry)`: 绘制椭圆。
*   `clear()`: 清空路径。

#### 示例:
```javascript
const v = addNode('vector');
const p = new Path();
p.moveTo(0, 0);
p.lineTo(100, 50);
p.lineTo(0, 100);
p.close();

v.path = p; // 系统自动转换为 SVG 字符串
```

在表达式中使用：
```javascript
// vector.path expression
const p = new Path();
const y = Math.sin(t) * 50;
p.moveTo(0, 0);
p.lineTo(100, y);
return p; 
```

---

## 5. 节点对象属性 (Node Properties)

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
| `fill` | `color` | RW | #ffffff | 填充颜色 (Hex, RGB, 颜色名, 或 CSS 渐变)。<br>支持 `linear-gradient(...)` 和 `radial-gradient(...)`。 |

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
| `path` | `string` | RW | "" | **SVG Path Data**。可赋值字符串或 `Path` 对象。 |
| `stroke` | `color` | RW | #10b981 | 描边颜色。 |
| `strokeWidth` | `number` | RW | 2 | 描边宽度。 |
| `fill` | `color` | RW | transparent | 填充颜色。 |

### 变量 (Variable)
类型: `'value'`

| 属性名 | 类型 | 读/写 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `value` | `any` | RW | 0 | 变量存储的值。 |
