# EAN-13 商品条码编码与扫描校验实验服务

本地运行的 EAN-13 教学/实验后端，使用 **TypeScript + Node.js + SQLite**，只提供 HTTP API 与 CLI，不含任何前端页面。

核心编解码算法（校验位、L/G/R 编码、左侧奇偶组合、护栏）全部在 `src/ean13.ts` 中自行实现，只查阅标准编码表，**没有调用任何现成条码生成/识别引擎**。

## 功能边界

支持：

- 输入 **12 位** 数字：计算第 13 位校验位并补全；
- 输入 **13 位** 数字：验证校验位是否正确；
- 将数字串编码为 **95 位模块串**（不含静区）；
- 将 95 位模块串解码回 13 位数字，恢复隐含的首位；
- 批量校验/编码/解码，按原顺序逐条返回，坏数据不吞掉好数据；
- 命名样例、处理记录、报告的 SQLite 持久化，报告可重复打开并导出 JSON。

不支持（明确排除）：

- 图片识别、摄像头/扫描枪采集；
- 模糊、旋转、倒置、错位样本的纠错；
- 删除模块、补零、猜测数字等任何“猜测式修复”；
- 真实商品/厂商查询。**校验通过只说明数字符合 EAN-13 校验规则，不代表商品或厂商真实存在。**

仅处理正向、已对齐的标准 EAN-13 数据。

## 模块串含义

- `1` = 黑色模块（条），`0` = 白色模块（空）。
- 固定 **95 位**，不含两侧静区（quiet zone），布局为：

| 区段 | 位数 | 内容 |
| --- | --- | --- |
| 起始护栏 | 3 | `101` |
| 左侧 6 位数字 | 42 | 每位 7 位，L（奇校验）或 G（偶校验） |
| 中间护栏 | 5 | `01010` |
| 右侧 6 位数字 | 42 | 每位 7 位，R（Set C） |
| 结束护栏 | 3 | `101` |

首位数字不直接画成条码，而是由左侧 6 位使用 L 还是 G 的奇偶组合隐含表示；解码时再由该组合反查首位。

数字串始终以 **字符串** 形式存储（SQLite TEXT），因此前导零完整保留，例如 `0000000000000`。

## 错误码

所有失败响应都带 `ok:false`、`error.code`、中文 `message` 和原始 `input`：

| code | 含义 |
| --- | --- |
| `INVALID_DIGITS_LENGTH` | 数字串长度不是 12 或 13 |
| `INVALID_DIGITS_CHAR` | 数字串含非数字字符 |
| `INVALID_MODULES_LENGTH` | 模块串长度不是 95 |
| `INVALID_MODULES_CHAR` | 模块串含 `0`/`1` 以外字符 |
| `GUARD_DAMAGED` | 起始/中间/结束护栏不匹配 |
| `UNKNOWN_DIGIT_PATTERN` | 某个 7 位块在 L/G/R 表中查不到 |
| `INVALID_PARITY_PATTERN` | 左侧 L/G 组合不是 10 种合法首位模式之一 |
| `CHECKSUM_MISMATCH` | 校验位不符 |

失败输出示例：

```json
{
  "ok": false,
  "error": {
    "code": "GUARD_DAMAGED",
    "message": "中间护栏损坏：应为 01010",
    "input": "10100011010100111010111101111010001001011001101111100001010000101000010111010010000101100110101"
  }
}
```

## 环境要求

- Windows 本地直接运行，无需 Docker / WSL；
- Node.js **>= 22.5**（开发与验证使用 Node 25），使用内置 `node:sqlite`，无需编译原生模块、无需付费或在线服务；
- 数据默认保存在项目内 `data/ean13.db`。

## 安装与构建

```powershell
npm install
npm run build
```

## 启动服务

```powershell
# 编译产物启动（默认自动选择空闲端口）
npm start

# 开发模式（tsx 直跑 TypeScript）
npm run dev
```

- 默认监听 `127.0.0.1`，端口为操作系统分配的空闲端口，启动时打印实际地址；
- 指定端口：`$env:PORT="8080"; npm start`；
- 指定数据目录：`$env:DATA_DIR="E:\some\dir"; npm start`。

### HTTP API

所有业务接口为 `POST`，请求/响应均为 JSON。

| 路径 | 请求体 | 说明 |
| --- | --- | --- |
| `GET /health` | - | 健康检查 |
| `/api/check` | `{"input":"400638133393"}` | 计算/校验校验位 |
| `/api/encode` | `{"input":"5901234123457"}` | 数字串 → 95 位模块串 |
| `/api/decode` | `{"input":"1010...0101"}` | 95 位模块串 → 数字串 |
| `/api/batch` | `{"items":[...]}` | 批量，元素可为字符串或 `{kind,op,input}` |
| `/api/samples` | `{"name","kind":"digits|modules","payload","note"}` | 保存命名样例 |
| `/api/samples` | `{"action":"list"}` | 列出样例 |
| `/api/records` | `{"limit":50}` | 查询处理记录 |
| `/api/reports` | `{"action":"list"}` | 列出报告 |
| `/api/reports` | `{"action":"get","id":1}` 或 `{"action":"get","name":"x"}` | 打开已保存报告 |
| `/api/reports` | `{"action":"export","name":"x","kind":"manual","report":{...}}` | 导出/命名保存；同名重复打开返回原结果 |

调用示例：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8080/api/encode -Method Post `
  -ContentType 'application/json' -Body '{"input":"5901234123457"}'
```

批量条目示例：

```json
{
  "items": [
    "4006381333931",
    "123",
    { "kind": "modules", "input": "1010...0101" },
    { "kind": "digits", "op": "encode", "input": "5901234123457" }
  ]
}
```

## CLI

```powershell
# 开发模式（推荐，免构建）
npm run cli -- check 4006381333931
npm run cli -- encode 5901234123457
npm run cli -- decode 10100010110100111011001100100110111101001110101010110011011011001000010101110010011101000100101
npm run cli -- batch samples-batch.json
npm run cli -- sample save 示例 digits 5901234123457
npm run cli -- sample list
npm run cli -- records 20
npm run cli -- report list
npm run cli -- report get 1

# 构建产物
node --experimental-sqlite dist/cli.js check 4006381333931
```

`batch` 接收 JSON 数组文件，或形如 `{"items":[...]}` 的对象。

## 测试与演示

```powershell
npm test     # 27 个 node:test 用例
npm run demo # 完整往返 + 改数字 + 改护栏 + 混合批次 + 持久化
```

测试基准没有用“自己的编码结果证明自己的解码”：

- 校验位使用已知真实条码 `4006381333931`、`5901234123457`；
- 模块串期望值由 Wikipedia 官方矢量图 `File:EAN-13-5901234123457.svg` 逐模块独立解析得到（解析脚本见 `scripts/parse-svg.cjs`，原始 SVG 存于 `data/ref/ean.svg`），再与编码器输出比对；
- 覆盖前导零、全部 0–9 首位奇偶规则、长度不符、非二进制模块、坏校验位、护栏损坏、无法识别模式、非法奇偶组合、混合好坏批次，以及“关闭并重新打开同一 SQLite 文件后记录/样例/报告仍可查”。

已知基准：`5901234123457` 的 95 位模块串为

```
10100010110100111011001100100110111101001110101010110011011011001000010101110010011101000100101
```

## 项目结构

```
src/ean13.ts    校验位 / L-G-R 编码 / 解码 / 错误码
src/db.ts       SQLite 建表与样例、记录、报告存取
src/service.ts  单条与批量业务、持久化、报告导出/复用
src/server.ts   HTTP API（默认空闲端口）
src/cli.ts     命令行入口
tests/          node:test 测试（算法、持久化、HTTP）
scripts/        演示脚本与独立基准 SVG 解析
data/           SQLite 数据库与参考文件（运行时生成/已含参考 SVG）
```
