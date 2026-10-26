# Excalidraw 本地接入
采用锁定的官方 @excalidraw/excalidraw 0.18.1，保留原版编辑界面与场景/图片序列化。
public/fonts 完整复制 npm 官方包的 234 个字体文件，字体许可随 third-party-notices.txt。
同步本地 bootstrap 在编辑器导入前设置绝对本地 ASSET_PATH。
实际冷启动验收发现该版本无条件追加 esm.sh 备用字体源；即使本地源可用，Chromium 也处理备用源并产生 CSP 拦截记录。
Vite 限定版本/限定库目录的 pre transform 仅将 ASSETS_FALLBACK_URL 的值改成本地 origin；不改画布、字体范围或导出逻辑。
构建强制只匹配一处声明，升级库必须复查；dev 关闭该库的预打包以同样使用本地适配。
应用仍保持 connect/font CSP 本地限制，导入过滤 iframe/embeddable/远程图片。
来源：https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation
源码：https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/fonts/ExcalidrawFontFace.ts
Chromium：https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/css/font_face.cc
冷启动和导出实际结果见 VALIDATION.md（验证后记录）。
