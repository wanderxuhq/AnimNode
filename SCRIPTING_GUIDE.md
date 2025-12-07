

# AnimNode Scripting API Reference

此文档定义了 AnimNode 脚本系统的编程接口。AI 模型在生成脚本时应严格遵守此规范。

## 1. 运行环境 (Runtime Environment)

*   **语言**: JavaScript (ES6+)。
*   **执行模式**: 原子化 (Atomic)。整个脚本作为一个事务执行，生成单条历史记录。
*   **沙箱**: 脚本运行在受限环境中，无 `window` / `document` 访问权限。
*   **入口**: 脚本按顺序执行，立即生效。

## 2. 坐标系 (Coordinate System)

*   **原点 (Origin)**: `(0, 0)` 位于画布的 **左上角**。
*   **方向**: X 轴向右为正，Y 轴向下为正。
*   **默认位置**: 使用 `addNode` 创建的新节点默认位于画布中心 (通常是 `400, 300`)。

---

## 3. 全局函数与变量 (Global Context)

在脚本的顶层作用域可直接访问以下对象：

### 核心函数
| 函数签名 | 返回值 | 描述 |
| :--- | :--- | :--- |
| `addNode(type: string)` | `NodeProxy` | 创建新节点。`type` 可选值: `'rect'`, `'circle'`, `'vector'`。默认位置为屏幕中心。 |
| `createVariable(value: any)` | `NodeProxy` | **创建持久化全局变量节点**。系统会自动使用 `const` 声明的变量名作为节点 ID。返回的对象可在 UI 中显示，也可在其他节点的表达式中通过名字引用。 |
| `removeNode(id: string)` | `void` | 删除指定 ID 的节点。 |
| `clear()` | `void` | **重要**: 清空当前画布上的所有节点。建议在生成式脚本开头调用。 |
| `log(...args)` | `void` | 输出信息到控制台。 |
| `warn(...args)` | `void` | 输出警告。 |
| `error(...args)` | `void` | 输出错误。 |

### 变量定义指南 (Variable Creation Guide)

请根据用途选择正确的变量定义方式：

#### A. 全局/持久化变量 (Global/Persistent Variables)
**场景**: 变量需要在 **UI面板中显示**，或者需要被 **其他节点的表达式 (Expression)** 引用。
**方法**: 使用 `createVariable`。这会在场景图 (Scene Graph) 中创建一个类型为 `value` 的节点。

```javascript
// 1. 创建全局变量 'SUN_X'
// 场景图中会出现一个名为 SUN_X 的节点
const SUN_X = createVariable(400);

// 2. 在其他节点的表达式中引用
// 只有通过 createVariable 创建的变量才能在 () => ... 中被引用
const earth = addNode('circle');
earth.x = () => SUN_X + 100; // 有效引用
```

#### B. 脚本局部变量 (Script-Local Variables)
**场景**: 变量仅在 **当前脚本逻辑内部** 使用（如循环计数器、临时计算结果），不需要暴露给 UI 或其他节点。
**方法**: 使用标准的 JavaScript `const` 或 `let`。**不要** 为这些变量使用 `createVariable`，以免污染场景图。

```javascript
// 这里的 count 和 i 只是脚本运行时的临时变量
// 执行完脚本后，它们不会作为节点存在于场景中
const count = 5; 
const spacing = 60;

for(let i = 0; i < count; i++) {
    const n = addNode('rect');
    // 使用局部变量进行计算并静态赋值
    n.x = 400 + (i - count/2) * spacing; 
}
```

### 内置对象
*   `Math`: 标准 JS Math 对象。
*   `Date`: 标准 JS Date 对象。
*   **节点 ID**: 场景中已存在的所有节点 ID 都会自动注册为全局变量 (例如 `rect_0`, `sun`)。

---

## 4. 节点对象 (Node Proxy)

`addNode` 或 `createVariable` 返回的对象。

### 元数据属性 (Metadata)
| 属性 | 类型 | 读/写 | 描述 |
| :--- | :--- | :--- | :--- |
| `.id` | `string` | RW | 节点的唯一标识符。修改此属性会重命名节点。**必须唯一**。 |
| `.type` | `string` | Read | 节点类型 (`rect`, `circle`, `vector`, `value`)。 |

### 视觉属性 (Visual Properties)
所有节点通用的变换和外观属性 (不适用于 `value` 类型)。

| 属性名 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `x` | `number` | 400 | X 轴位置 (单位: px)。原点在左上角。 |
| `y` | `number` | 300 | Y 轴位置 (单位: px)。原点在左上角，向下为正。 |
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

**Type: 'value' (Variable)**
| 属性名 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `value` | `number` | 0 | 变量的值。 |

---

## 5. 赋值语法规则 (Assignment Rules)

AnimNode 支持两种属性赋值模式。

### 模式 A: 静态赋值 (Static Assignment)
设置一个固定的常数值。
```javascript
// 直接赋值
node.x = 100; 

// 使用变量赋值 (注意：这是静态快照！)
// 如果 R 是普通数值/字符串变量，这里会静态读取 R 的当前值并赋值给 node.radius
const R = createVariable(50);
node.radius = R; 
// 结果: node.radius 的值被静态设置为 50。
// 如果后续 R 变为 100，node.radius 仍然是 50。
```

### 模式 B: 表达式赋值 (Expression Assignment)
设置一个随时间变化的动画逻辑或动态链接。
**语法**: 赋值一个 **箭头函数 (Arrow Function)**。

```javascript
// 正确写法：创建动态表达式
// 让 x 在 300 到 500 之间往复运动
node.x = () => 400 + Math.sin(t) * 100;

// 动态引用全局变量
const ORBIT_R = createVariable(150);

// 注意使用箭头函数 () => ...
// 这样 engine 会保存 "return ORBIT_R;" 作为表达式
// 结果: node.x 会每一帧读取 ORBIT_R 的当前值
node.x = () => 400 + Math.cos(t) * ORBIT_R; 
```

### 特殊情况：函数变量 (Function Variable)
如果你创建的变量本身就是一个函数，那么将其直接赋值给属性时，系统会自动将其视为表达式链接。

```javascript
// 1. 创建一个函数类型的变量
const GET_Y = createVariable(() => 300 + Math.sin(t) * 100);

// 2. 直接赋值
// 因为 GET_Y 是函数类型，系统会自动将其设置为 'code' 模式，并链接到 GET_Y
node.y = GET_Y; 
// 等同于: node.y = () => GET_Y();
```

### 表达式内部环境
在箭头函数 `() => { ... }` 内部，可访问以下特殊变量：

1.  **`t`** (`number`): 全局时间，单位为秒。
2.  **`val`** (`any`): 该属性当前的静态基准值。
3.  **`ctx`** (`object`): 上下文工具对象。
4.  **`全局变量`**: 直接使用通过 `createVariable` 创建的变量名 (Node ID)。

---

## 6. 代码生成示例 (Examples)

### 全局变量示例
```javascript
clear();
// 1. 创建全局变量 (会自动显示在列表中, ID为 SUN_X)
const SUN_X = createVariable(400); 
const ORBIT_R = createVariable(150);

// 2. 创建节点
const sun = addNode('circle');
sun.radius = 30;
sun.fill = "#fbbf24";
// 3. 动态引用变量 (使用箭头函数)
sun.x = () => SUN_X; 
sun.y = 300;

const earth = addNode('circle');
earth.radius = 10;
earth.fill = "#3b82f6";
// 4. 在表达式中使用变量运算
earth.x = () => SUN_X + Math.cos(t) * ORBIT_R;
earth.y = () => 300 + Math.sin(t) * ORBIT_R;
```

### 批量生成 (Grid System)
```javascript
clear();
// count 和 i 是脚本局部变量，不需要 createVariable
const count = 5; 
for(let i=0; i<count; i++) {
    const n = addNode('rect');
    n.x = 400 + (i - count/2) * 60;
    n.y = () => 300 + Math.sin(t + i) * 50; 
}
```