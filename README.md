# 问卷星AI多厂商多线路做题
问卷星AI多厂商多线路做题，多个APIKEY轮询，某个线路挂了下一个线路重试继续做题。

1. Chrome 或 Edge 安装 **Tampermonkey 插件**
2. 浏览器管理扩展程序启用 **开发者模式**
3. Tampermonkey 插件详情  
   - 打开 **允许运行用户脚本**
   - **在无痕模式下启用**
   - **固定到工具栏**
4. 工具栏点击 Tampermonkey → 管理面板 → `+` 新建脚本 → 复制 `wjx_xjbt.js` 内容到编辑器保存
5. API_MODELS里配置你的API_KEY和几条线路，支持OpenAI、Gemini、Anthropic，推荐Gemini，可以在[aistudio.google](https://aistudio.google.com/app/api-keys)申请免费API_KEY，申请多个项目的API_KEY即可，大概一个API_KEY一天额度能做160题左右
6. 打开问卷星开始答题，可以打开F12观察Console运行情况，若Tampermonkey弹出跨域请求API厂商地址，请选择**总是允许该域名**，建议每次答题都是打开新的无痕窗口。