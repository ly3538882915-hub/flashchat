# FlashChat 云部署保姆级教程

> 部署完成后，你会得到一个类似 `https://flashchat-xxxx.up.railway.app` 的公网地址，发给任何人都能用，24 小时在线，不用开电脑。

---

## 整体流程（3 步）

```
第 1 步：上传代码到 GitHub（5 分钟）
第 2 步：在 Railway 一键部署（3 分钟）
第 3 步：把公网地址发给朋友（立刻）
```

---

## 准备工作

你需要注册两个免费账号：

| 平台 | 网址 | 用途 |
|------|------|------|
| GitHub | https://github.com | 存放代码 |
| Railway | https://railway.app | 运行服务器 |

两个都用邮箱注册就行，免费的。

---

## 第 1 步：上传代码到 GitHub

### 1.1 安装 Git（如果没装过）

打开终端（命令提示符），输入：
```
git --version
```
如果显示版本号（如 `git version 2.43.0`），说明已安装，跳过。
如果提示找不到命令，去 https://git-scm.com/downloads 下载安装，一路下一步就行。

### 1.2 在 GitHub 创建仓库

1. 登录 GitHub → 右上角 **"+"** → **New repository**
2. 仓库名填：`flashchat`
3. 选 **Private**（私有，别人看不到你的代码）
4. 勾选 **Add a README file**
5. 点 **Create repository**

### 1.3 把代码推送到 GitHub

打开终端，依次运行以下命令（复制一行运行一行）：

```bash
# 进入项目目录
cd F:\TelegramCN\flash_chat_web

# 初始化 Git
git init

# 添加所有文件（.gitignore 会自动排除 node_modules 和 data）
git add .

# 提交
git commit -m "FlashChat V0.2"

# 设置主分支名
git branch -M main

# 关联你的 GitHub 仓库（把 你的用户名 换成你的 GitHub 用户名）
git remote add origin https://github.com/你的用户名/flashchat.git

# 推送
git push -u origin main
```

推送时会弹出 GitHub 登录窗口，登录授权即可。

完成后，刷新你的 GitHub 仓库页面，应该能看到所有代码文件。

---

## 第 2 步：在 Railway 部署

### 2.1 登录 Railway

1. 打开 https://railway.app
2. 点 **Login** → 用 GitHub 账号登录（一键授权）

### 2.2 创建新项目

1. 点 **New Project**（新建项目）
2. 选 **Deploy from GitHub repo**（从 GitHub 部署）
3. 找到你刚才创建的 `flashchat` 仓库，点它
4. Railway 会自动识别这是一个 Node.js 项目

### 2.3 配置环境变量（重要！）

在部署页面的 **Variables** 标签页，添加以下变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `JWT_SECRET` | 随便打一串复杂字符，比如 `myflashchat2024secretxyz789` | 用于加密登录信息，别用默认值 |

添加方法：点 **New Variable** → Name 填 `JWT_SECRET`，Value 填你的密钥 → **Add**。

### 2.4 添加持久化存储（保存聊天记录）

> Railway 默认每次重新部署会清空数据。加一个 Volume 就能永久保存聊天记录。

1. 在项目页面点 **+ New**（新建）
2. 选 **Database** → 不用选，直接关掉
3. 改为：点 **+ New** → **Volume**（磁盘）
4. 挂载路径填：`/opt/render/project/src/data`
   - 注意：这里填的是 `data`，对应代码里的数据库目录
   - 如果 Railway 提示路径不对，试试填 `/app/data`
5. 确认创建

> **如果你不确定挂载路径**：Railway 部署后，在 **Settings** → **Volumes** 里可以修改。关键是路径要指向代码中 `data/` 文件夹的绝对路径。通常 Railway 的项目根目录是 `/app`，所以填 `/app/data`。

### 2.5 等待部署完成

Railway 会自动：
1. 拉取你的代码
2. 运行 `npm install` 安装依赖
3. 运行 `npm start`（即 `node server.js`）启动服务

页面上的部署状态会从 **Building** → **Deploying** → **Active**（绿色）。

整个过程大约 2-3 分钟。

### 2.6 获取公网地址

1. 部署成功后，在项目页面点 **Settings**
2. 找到 **Networking** 区域
3. 点 **Generate Domain**（生成域名）
4. 你会得到一个地址，类似：`https://flashchat-xxxx.up.railway.app`

**这就是你的公网地址！** 发给任何人都能用。

### 2.7 验证部署

浏览器打开你的公网地址，应该能看到 FlashChat 登录页面。注册一个账号试试，如果能注册成功并进入聊天界面，说明部署成功。

---

## 第 3 步：把地址发给朋友

把你的公网地址（比如 `https://flashchat-xxxx.up.railway.app`）发给朋友。

朋友只需要：
1. 手机或电脑浏览器打开这个地址
2. 点注册，填用户名密码昵称
3. 搜索你的用户名，发起聊天
4. 开聊！

---

## 备选方案：用 Render 部署

如果 Railway 用不了（比如注册问题），可以用 Render。

### 步骤

1. 打开 https://render.com → 用 GitHub 登录
2. 点 **New +** → **Web Service**
3. 连接你的 GitHub 仓库 `flashchat`
4. 填写配置：
   - **Name**：`flashchat`
   - **Runtime**：Node
   - **Build Command**：`npm install`
   - **Start Command**：`node server.js`
   - **Instance Type**：Free（免费）
5. 点 **Advanced** 展开 → 添加环境变量：
   - Key: `JWT_SECRET`，Value: 你的密钥
6. 点 **Create Web Service**
7. 等待部署完成（约 3-5 分钟）
8. 部署成功后会得到一个 `https://flashchat.onrender.com` 的地址

### Render 注意事项
- 免费版 15 分钟无人访问会休眠，下次访问时自动唤醒（等 30 秒左右）
- 免费版磁盘是临时的，重新部署后数据会丢失
- 如需数据持久化，需要付费添加 Disk（每月 $0.25/GB）

---

## 常见问题

### Q: 部署时报错 "better-sqlite3 build failed"？

这是原生模块编译问题。Railway 和 Render 都支持自动编译，如果失败：
1. 确认 `package.json` 里有 `"engines": {"node": ">=18.0.0"}`
2. 删掉 `node_modules` 和 `package-lock.json`，重新 `npm install`，再推送

### Q: 部署成功但打开页面是白屏？

1. 检查 Railway 的 **Deployments** → **Logs**（日志），看有没有报错
2. 确认环境变量 `PORT` 不需要手动设（Railway 自动注入）
3. 确认代码里用的是 `process.env.PORT || 3000`

### Q: 聊天记录消失了？

说明没配持久化 Volume，数据存在临时容器里被清了。按第 2.4 步添加 Volume。

### Q: 朋友打不开地址？

1. 确认 Railway 部署状态是 **Active**（绿色）
2. 确认点了 **Generate Domain** 生成了公网域名
3. 地址是 `https://` 开头的，不是 `http://`

### Q: 免费额度用完了怎么办？

Railway 免费额度：每月 $5 信用额度，大约够跑一个小项目 2-3 周。用完后：
- 方案 A：充值 $5/月，持续运行
- 方案 B：换 Render 免费版（有休眠但不要钱）
- 方案 C：用自己的电脑 + ngrok（回到方案二）

### Q: 想自定义域名？

Railway：Settings → Networking → Custom Domain，填入你买的域名，按提示配置 DNS。

---

## 部署后管理

### 查看日志
Railway 项目页面 → **Deployments** → 点最新的部署 → **Logs** 标签
能看到所有服务器日志，包括用户注册、消息收发等。

### 更新代码
本地改完代码后：
```bash
cd F:\TelegramCN\flash_chat_web
git add .
git commit -m "更新说明"
git push
```
Railway 会自动检测到新代码，自动重新部署。

### 重启服务
Railway 项目页面 → **Deployments** → 点最新的部署 → **Redeploy**（重新部署）

---

## 费用说明

| 平台 | 免费额度 | 超出后 |
|------|---------|--------|
| Railway | 每月 $5 信用（约 500 小时运行） | 按用量付费，约 $0.000463/秒 |
| Render | 免费版（有休眠） | $7/月 升级为无休眠 |

对于个人小团队用（几个人聊天），免费额度完全够用。
