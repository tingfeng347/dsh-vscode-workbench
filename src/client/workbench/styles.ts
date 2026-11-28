import { DSH_MARK_PATH, DSH_MARK_VIEWBOX } from '../ui/DshMark.tsx'
import { GIT_DIFF_ACCENTS } from '../git/GitSplitDiff.ts'
import { WORKBENCH_MARK_SVG } from '../ui/WorkbenchMark.ts'

/** The plugin's own brand mark, inlined so the empty editor state needs no extra asset request. */
const WORKBENCH_MARK = `url("data:image/svg+xml,${encodeURIComponent(WORKBENCH_MARK_SVG)}")`

/** The bundled DSH whale as a CSS mask, used by the DSH tab marker. */
const DSH_MARK_MASK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${DSH_MARK_VIEWBOX}"><path d="${DSH_MARK_PATH}" fill="#000"/></svg>`)}")`

const CSS = String.raw`
@font-face{font-family:codicon;font-display:block;src:url('/dsh-vscode/codicons/codicon.ttf') format('truetype')}
:root{--dvw-titlebar-height:0px}html[data-platform=darwin]{--dvw-titlebar-height:var(--dsh-frame-top-clearance,48px)}html[data-windows-titlebar]{--dvw-titlebar-height:var(--dsh-frame-top-clearance,40px)}
/* Keep DSH's history-aware turn rail available in narrow workbench conversations. */
nav[data-dvw-turn-navigation=on]{display:block;left:6px;right:auto;width:28px;-webkit-app-region:no-drag}
nav[data-dvw-turn-navigation=off]{display:none}
nav[data-dvw-turn-navigation=on] button[data-index]::before{left:0;right:auto;transform-origin:left center}
nav[data-dvw-turn-navigation=on] button[data-index]::after{left:0;right:auto}
nav[data-dvw-turn-navigation=on] [role=tooltip]{left:calc(100% + 8px);right:auto;width:min(360px,calc(100cqw - 44px))}
[data-dvw-turn-navigation-slot=on]+div>div:first-child{padding-inline-start:max(42px,calc(var(--dsh-composer-side-clearance,0px) + 16px))}
.codicon{display:inline-block;font:normal normal normal 16px/1 codicon;text-align:center;text-decoration:none;text-rendering:auto;-webkit-font-smoothing:antialiased;user-select:none}
.codicon-add:before{content:"\ea60"}.codicon-git-branch:before,.codicon-source-control:before{content:"\ea68"}.codicon-debug-alt:before{content:"\eb91"}.codicon-search:before{content:"\ea6d"}.codicon-edit:before{content:"\ea73"}.codicon-close:before{content:"\ea76"}.codicon-close-all:before{content:"\eac1"}.codicon-cloud-download:before{content:"\eac2"}.codicon-cloud-upload:before{content:"\eac3"}.codicon-file:before{content:"\ea7b"}.codicon-new-file:before{content:"\ea7f"}.codicon-new-folder:before{content:"\ea80"}.codicon-folder:before{content:"\ea83"}.codicon-trash:before{content:"\ea81"}.codicon-code:before{content:"\eac4"}.codicon-check:before{content:"\eab2"}.codicon-chevron-down:before{content:"\eab4"}.codicon-chevron-right:before{content:"\eab6"}.codicon-color-mode:before{content:"\eac6"}.codicon-diff:before,.codicon-diff-sidebyside:before{content:"\eae1"}.codicon-diff-single:before{content:"\ec22"}.codicon-discard:before{content:"\eae2"}.codicon-file-code:before{content:"\eae9"}.codicon-file-media:before{content:"\eaea"}.codicon-file-pdf:before{content:"\eaeb"}.codicon-file-zip:before{content:"\eaef"}.codicon-files:before{content:"\eaf0"}.codicon-folder-opened:before{content:"\eaf7"}.codicon-git-commit:before{content:"\eafc"}.codicon-graph:before{content:"\eb03"}.codicon-home:before{content:"\eb06"}.codicon-list-tree:before{content:"\eb86"}.codicon-preview:before{content:"\eb2f"}.codicon-refresh:before{content:"\eb37"}.codicon-remove:before{content:"\eb3b"}.codicon-check-all:before{content:"\ebb1"}
.codicon-case-sensitive:before { content: "\eab1" }.codicon-whole-word:before { content: "\eb7e" }.codicon-regex:before { content: "\eb38" }.codicon-preserve-case:before { content: "\eb2e" }.codicon-replace:before { content: "\eb3d" }.codicon-replace-all:before { content: "\eb3c" }.codicon-ellipsis:before { content: "\ea7c" }.codicon-clear-all:before { content: "\eabf" }.codicon-collapse-all:before { content: "\eac5" }.codicon-expand-all:before { content: "\eb95" }
.codicon-layout-sidebar-right:before{content:"\ebf4"}.codicon-layout-sidebar-right-off:before{content:"\ec00"}.codicon-screen-full:before{content:"\eb4c"}.codicon-screen-normal:before{content:"\eb4d"}.codicon-settings:before{content:"\eb51"}.codicon-sparkle:before{content:"\ec10"}.codicon-split-horizontal:before{content:"\eb56"}.codicon-terminal:before{content:"\ea85"}
.dvw-overlay{--dvw-side-width:210px;--dvw-graph-ref:#3794ff;--dvw-base:var(--dsw-alias-bg-base,#181818);--dvw-surface-1:var(--dsw-alias-bg-layer-1,#1e1e1e);--dvw-surface-2:var(--dsw-alias-bg-layer-2,#252526);--dvw-surface-3:var(--dsw-alias-bg-layer-3,#2d2d30);--dvw-side:var(--dvw-surface-1);--dvw-tab-active:var(--dvw-surface-2);--dvw-gutter:var(--dvw-base);--dvw-text:var(--dsw-alias-label-primary,#ccc);--dvw-text-2:var(--dsw-alias-label-secondary,#aaa);--dvw-text-3:var(--dsw-alias-label-tertiary,#858585);--dvw-border:var(--dsw-alias-border-l2,#333);--dvw-border-soft:var(--dsw-alias-border-l3,#292929);--dvw-hover:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));--dvw-active:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14));--dvw-accent:var(--dsw-alias-state-business-primary,#3b82f6);--dvw-error:var(--dsw-alias-state-error-primary,#f48771);--dvw-success:var(--dsw-alias-state-success-primary,#73c991);--dvw-warn:var(--dsw-alias-state-warn-primary,#d7ba7d);position:absolute;inset:0;z-index:100;display:grid;grid-template-columns:48px var(--dvw-side-width) minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto 30px;box-sizing:border-box;padding-top:calc(var(--dvw-titlebar-height) + 6px);background:var(--dvw-gutter);color:var(--dvw-text);pointer-events:auto;font:13px/1.4 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);overflow:hidden;color-scheme:light}
.dvw-titlebar{display:none}html[data-platform=darwin] .dvw-titlebar{position:absolute;top:0;right:0;left:0;z-index:6;display:flex;align-items:center;gap:8px;height:var(--dvw-titlebar-height);padding:0 12px 0 84px;border-bottom:1px solid var(--dvw-border-soft);background:var(--dvw-base);color:var(--dvw-text-3);font-size:12px;-webkit-app-region:drag;user-select:none}.dvw-titlebar strong{flex:none;font-weight:600;color:var(--dvw-text-2)}.dvw-titlebar span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
html[data-windows-titlebar] .dvw-overlay{top:var(--dvw-titlebar-height);padding-top:6px}
html[data-platform=darwin] .dvw-overlay{padding-top:var(--dvw-titlebar-height)}
body[data-ds-dark-theme] .dvw-overlay,.dvw-overlay[data-dvw-theme=dark]{color-scheme:dark}
.dvw-overlay[data-dvw-theme=dark]{--dvw-base:#191a1b;--dvw-surface-1:#121314;--dvw-surface-2:#202122;--dvw-surface-3:#252526;--dvw-side:#191a1b;--dvw-tab-active:#2a2b2c;--dvw-gutter:#191a1b;--dvw-graph-ref:#3794ff;--dvw-text:#bfbfbf;--dvw-text-2:#8c8c8c;--dvw-text-3:#6e6e6e;--dvw-border:#2a2b2c;--dvw-border-soft:#242526;--dvw-hover:#ffffff12;--dvw-active:#ffffff1f;--dvw-accent:#307e9f;--dvw-error:#e06c75;--dvw-success:#98c379;--dvw-warn:#e5c07b}
.dvw-overlay[data-dvw-theme=light]{--dvw-base:#fff;--dvw-surface-1:#fff;--dvw-surface-2:#fff;--dvw-surface-3:#fff;--dvw-side:#fff;--dvw-tab-active:#fff;--dvw-gutter:#fff;--dvw-graph-ref:#0063d3;--dvw-text:#171717;--dvw-text-2:#5c5c5c;--dvw-text-3:#8c8c8c;--dvw-border:#e2e2e2;--dvw-border-soft:#efefef;--dvw-hover:#0000000c;--dvw-active:#00000014;--dvw-accent:#0066cc;--dvw-error:#d13438;--dvw-success:#2e7d32;--dvw-warn:#8a6100;color-scheme:light}
/* Keep the light tab-strip palette local to opened-file navigation. */
.dvw-overlay[data-dvw-theme=light] .dvw-tabs{--dvw-base:#f9fafb;--dvw-text:#1f1f1f;--dvw-text-2:#616161;--dvw-border:#e5e5e5;--dvw-border-soft:#ececec;--dvw-hover:#0000000d;--dvw-accent:#0078d4}
.dvw-overlay[data-dvw-theme=light] .dvw-act[data-active=true]::before{background:#00000010}
.dvw-overlay *{box-sizing:border-box}.dvw-overlay ::-webkit-scrollbar{width:10px;height:10px}.dvw-overlay ::-webkit-scrollbar-track{background:transparent}.dvw-overlay ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dvw-text) 20%,transparent);border:2px solid transparent;background-clip:padding-box;border-radius:6px}.dvw-overlay ::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--dvw-text) 32%,transparent);background-clip:padding-box}.dvw-overlay ::-webkit-scrollbar-corner{background:transparent}.dvw-activity{grid-row:1/3;background:var(--dvw-base);border:1px solid var(--dvw-border);border-radius:8px 0 0 8px;display:flex;flex-direction:column;align-items:center;overflow:hidden}.dvw-activity-menu{min-width:220px}.dvw-activity-main{width:100%;min-height:0;overflow:auto;scrollbar-width:none;display:flex;flex-direction:column;align-items:center}.dvw-activity-bottom{width:100%;margin-top:auto;flex-shrink:0;display:flex;flex-direction:column;align-items:center}.dvw-menu-separator{height:1px;margin:4px 0;background:var(--dvw-border-soft)}.dvw-menu-check{display:inline-block;width:14px;flex:none;color:var(--dvw-text)}.dvw-act{flex-shrink:0;touch-action:none;user-select:none}.dvw-act[data-dragging=true]{opacity:.35}.dvw-activity-ghost{position:fixed;z-index:120;width:48px;height:48px;display:grid;place-items:center;pointer-events:none;border-radius:8px;background:var(--dvw-tab-active);color:var(--dvw-text);font-size:22px;box-shadow:0 8px 22px rgba(0,0,0,.3);transform:translate(-50%,-50%) scale(1.08);opacity:.95}.dvw-activity-ghost .codicon{font-size:18px}.dvw-act{position:relative;width:48px;height:48px;padding:0;border:0;background:transparent;color:var(--dvw-text-3);font-size:22px;cursor:pointer;display:grid;place-items:center}.dvw-act::before{content:"";position:absolute;left:50%;top:50%;width:32px;height:32px;border-radius:6px;background:transparent;transform:translate(-50%,-50%)}.dvw-act .codicon,.dvw-act svg{position:relative;z-index:1}.dvw-act .codicon{font-size:18px}.dvw-act:hover,.dvw-act[data-active=true]{color:var(--dvw-text)}.dvw-act:hover::before{background:var(--dvw-hover)}.dvw-act[data-active=true]::before{background:var(--dvw-tab-active)}.dvw-act.dsh{margin-top:auto}.dvw-side{grid-column:2;grid-row:1/3;min-width:0;width:100%;background:var(--dvw-side);border-top:1px solid var(--dvw-border);border-bottom:1px solid var(--dvw-border);border-right:1px solid var(--dvw-border);border-top-right-radius:8px;border-bottom-right-radius:8px;overflow:hidden;display:flex;flex-direction:column}.dvw-side-resizer{grid-column:2;grid-row:1/3;justify-self:end;width:4px;height:100%;z-index:4;cursor:ew-resize;transform:translateX(2px);touch-action:none}.dvw-side-resizer:hover,.dvw-side-resizer:focus-visible,.dvw-side-resizer[data-dragging=true]{background:var(--dvw-accent)}.dvw-side-head{height:35px;display:flex;align-items:center;padding:0 12px;text-transform:uppercase;font-size:11px;letter-spacing:.4px}.dvw-toolbar{margin-left:auto;display:flex;gap:2px}.dvw-icon{border:0;background:transparent;color:var(--dvw-text-2);border-radius:4px;min-width:24px;height:24px;display:inline-grid;place-items:center;cursor:pointer}.dvw-icon:hover{background:var(--dvw-hover);color:var(--dvw-text)}.dvw-icon:disabled{opacity:.45;cursor:default}.dvw-file-picker{display:none}.dvw-tree,.dvw-results,.dvw-git{overflow:auto;flex:1}.dvw-tree[data-drop-target=true]{outline:1px dashed var(--dvw-accent);outline-offset:-3px}.dvw-tree-row{display:flex;align-items:center;height:22px;padding-right:6px;cursor:pointer;white-space:nowrap}.dvw-tree-row:hover{background:var(--dvw-hover)}.dvw-tree-row[data-selected=true],.dvw-tree-row[data-drop-target=true]{background:var(--dvw-active)}.dvw-chevron{width:16px;flex:none;text-align:center;color:var(--dvw-text-3)}.dvw-file-icon{width:16px;height:16px;flex:none;display:block;object-fit:contain;color:var(--dvw-text-2)}.dvw-file-icon.folder{color:var(--dvw-accent)}.dvw-tree-name{overflow:hidden;text-overflow:ellipsis}.dvw-tree-rename,.dvw-tree-create-input{min-width:0;flex:1;height:20px;border:1px solid var(--dvw-accent);border-radius:2px;background:var(--dvw-surface-1);color:var(--dvw-text);padding:0 3px;font:inherit;letter-spacing:0;outline:0}.dvw-tree-create-row{cursor:text}.dvw-tree-create-row:hover{background:transparent}.dvw-tree-create-input::placeholder{color:var(--dvw-text-3)}.dvw-tree-create-input[aria-invalid=true]{border-color:var(--dvw-error)}.dvw-tree-create-error{min-height:20px;padding-top:2px;padding-right:6px;padding-bottom:3px;color:var(--dvw-error);font-size:11px;line-height:15px;white-space:normal;overflow-wrap:anywhere}.dvw-tree-status{margin-left:auto;padding-left:6px;font-size:11px;font-weight:600;color:var(--dvw-warn)}.dvw-tree-status[data-status=M]{color:var(--dvw-warn)}.dvw-tree-status[data-status=A]{color:var(--dvw-success)}.dvw-tree-status[data-status=D]{color:var(--dvw-error)}.dvw-context-menu{position:fixed;z-index:40;min-width:148px;padding:4px;border:1px solid var(--dvw-border);border-radius:5px;background:var(--dvw-surface-3);box-shadow:0 6px 20px rgba(0,0,0,.3)}.dvw-context-menu button{width:100%;height:28px;border:0;border-radius:3px;background:transparent;color:var(--dvw-text);display:flex;align-items:center;gap:8px;padding:0 8px;text-align:left;font:inherit;cursor:pointer}.dvw-context-menu button:hover{background:var(--dvw-hover)}.dvw-context-menu .dvw-context-delete{color:var(--dvw-error)}.dvw-tab-menu{min-width:220px}.dvw-tab-menu button{justify-content:space-between;gap:24px}.dvw-tab-menu button span{color:var(--dvw-text-3);font-size:11px}.dvw-tab-menu button:disabled{opacity:.45;cursor:default}.dvw-tab-menu button:disabled:hover{background:transparent}
.dvw-main{grid-column:3;grid-row:1;position:relative;display:flex;min-width:0;min-height:0;flex-direction:column;background:var(--dvw-surface-1);border-left:1px solid var(--dvw-border);border-top:1px solid var(--dvw-border);border-right:1px solid var(--dvw-border);border-bottom:1px solid var(--dvw-border);border-radius:8px;margin-left:3px;overflow:hidden}.dvw-tabs{height:35px;background:linear-gradient(to top,var(--dvw-border) 0 1px,var(--dvw-base) 1px 100%);display:flex;overflow:hidden}.dvw-tabs[data-empty]{display:none}.dvw-tab{position:relative;height:35px;margin:0;min-width:110px;max-width:260px;border:0;border-right:1px solid var(--dvw-border-soft);border-radius:8px 8px 0 0;background:transparent;color:var(--dvw-text-2);padding:0 8px 0 12px;display:flex;align-items:center;gap:6px;cursor:pointer;flex:none;white-space:nowrap}.dvw-tab:hover{background:var(--dvw-hover)}.dvw-tab[data-active=true]{background:var(--dvw-surface-1);color:var(--dvw-text);border-top:1px solid var(--dvw-border);border-right:1px solid var(--dvw-border)}.dvw-tab-icon{width:16px;height:16px;flex:none;object-fit:contain}.dvw-tab-close{width:16px;height:16px;flex:none;display:grid;place-items:center;border-radius:3px;opacity:0}.dvw-tab-close:hover{background:var(--dvw-hover);color:var(--dvw-text)}.dvw-tab[data-active=true] .dvw-tab-close,.dvw-tab:hover .dvw-tab-close{opacity:1}.dvw-tab-name{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;text-align:left;white-space:nowrap}.dvw-editor{position:relative;flex:1;min-height:0}.dvw-editor-toolbar{position:absolute;z-index:3;top:0;right:0;left:0;height:35px;display:flex;align-items:center;justify-content:flex-end;gap:4px;padding:0 10px;border-bottom:1px solid var(--dvw-border-soft);background:var(--dvw-surface-1)}.dvw-editor-body{position:absolute;inset:0;min-height:0}.dvw-editor-body[data-toolbar=true]{top:35px}.dvw-mode-button{height:27px;padding:0 10px;display:flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--dvw-text-2);cursor:pointer}.dvw-mode-button:hover{background:var(--dvw-hover)}.dvw-mode-button[data-active=true]{border-color:var(--dvw-border);background:var(--dvw-active);color:var(--dvw-text)}.dvw-empty{height:100%;display:grid;place-items:center;color:var(--dvw-text-3);text-align:center}.dvw-empty strong{font-size:24px;color:var(--dvw-text-2)}.dvw-message{padding:12px;color:var(--dvw-warn)}.dvw-message button{margin-left:10px;padding:2px 10px;border:1px solid var(--dvw-border);border-radius:4px;background:var(--dvw-surface-2);color:var(--dvw-text);font:inherit;cursor:pointer}.dvw-message button:hover{background:var(--dvw-hover)}
.dvw-bottom-resizer{height:4px;cursor:ns-resize}.dvw-bottom-resizer:hover{background:var(--dvw-accent)}.dvw-bottom-reveal{position:absolute;left:0;right:0;bottom:0;height:6px;z-index:4;cursor:ns-resize}.dvw-bottom-reveal::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:transparent}.dvw-bottom-reveal:hover::after{background:var(--dvw-accent)}.dvw-bottom{grid-column:3;grid-row:2;height:260px;min-height:120px;border-top:1px solid var(--dvw-border);border-left:1px solid var(--dvw-border);border-right:1px solid var(--dvw-border);border-bottom:1px solid var(--dvw-border);border-radius:8px;margin-top:4px;margin-left:3px;background:var(--dvw-base);display:flex;flex-direction:column}.dvw-bottom-head{height:35px;display:flex;align-items:center;gap:14px;padding:0 12px}.dvw-bottom-title{display:inline-flex;align-items:center;border:0;border-bottom:1px solid transparent;background:transparent;color:var(--dvw-text-2);padding:0 6px;height:35px;font:inherit}
button.dvw-bottom-title{cursor:pointer}.dvw-bottom-title:hover,.dvw-bottom-title[aria-pressed=true],.dvw-bottom-title[data-active=true]{color:var(--dvw-text)}.dvw-bottom-title[aria-pressed=true],.dvw-bottom-title[data-active=true]{border-bottom-color:currentColor}.dvw-bottom-body{flex:1;min-height:0}.dvw-status{grid-column:1/4;grid-row:3;background:var(--dvw-base);color:var(--dvw-text);display:flex;align-items:center;padding:0 8px;gap:18px;font-size:12px}.dvw-theme-control{position:relative;margin-left:auto}.dvw-theme-trigger{height:22px;min-width:112px;display:flex;align-items:center;gap:7px;padding:0 8px;border:0;border-radius:5px;background:color-mix(in srgb,#000 17%,transparent);color:#fff;cursor:pointer}.dvw-theme-trigger:hover{background:color-mix(in srgb,#000 27%,transparent)}.dvw-theme-orb{width:13px;height:13px;border:2px solid #fff;border-radius:50%;background:linear-gradient(90deg,#191a1b 50%,#fff 50%)}.dvw-theme-orb.dark{background:#191a1b}.dvw-theme-orb.light{background:#fff}.dvw-theme-menu{position:absolute;right:0;bottom:29px;width:224px;padding:6px;border:1px solid var(--dvw-border);border-radius:10px;background:var(--dvw-surface-3);box-shadow:0 10px 35px rgba(0,0,0,.28);color:var(--dvw-text)}.dvw-theme-menu button{width:100%;min-height:48px;border:0;border-radius:7px;background:transparent;color:inherit;display:grid;grid-template-columns:30px 1fr 20px;align-items:center;text-align:left;padding:6px;cursor:pointer}.dvw-theme-menu button:hover,.dvw-theme-menu button[aria-checked=true]{background:var(--dvw-hover)}.dvw-theme-menu strong,.dvw-theme-menu small{display:block}.dvw-theme-menu small{color:var(--dvw-text-3);margin-top:2px}.dvw-theme-swatch{width:22px;height:22px;border-radius:6px;border:1px solid var(--dvw-border);background:linear-gradient(135deg,#191a1b 0 50%,#fff 50%)}.dvw-theme-swatch.dark{background:#191a1b}.dvw-theme-swatch.light{background:#fff}
.dvw-input,.dvw-textarea,.dvw-select{width:100%;border:1px solid var(--dvw-border);border-radius:2px;background:var(--dvw-surface-2);color:var(--dvw-text);padding:3px 7px;outline:none}.dvw-input:focus,.dvw-textarea:focus,.dvw-select:focus{border-color:var(--dvw-accent)}.dvw-search-hit{background:color-mix(in srgb,var(--dvw-accent) 28%,transparent);border-radius:2px}
.dvw-git-head{padding:7px 10px;border-bottom:1px solid var(--dvw-border);display:flex;align-items:center;gap:8px;position:relative}.dvw-branch{min-width:0;border:0;background:transparent;color:var(--dvw-text);font:inherit;font-weight:600;display:flex;align-items:center;gap:5px;cursor:pointer}.dvw-branch-caret{margin-left:2px;font-size:14px;color:var(--dvw-text-3)}.dvw-branch-menu{position:absolute;z-index:12;top:calc(100% + 2px);left:6px;right:6px;padding:4px;border:1px solid var(--dvw-border);border-radius:8px;background:var(--dvw-surface-2);box-shadow:0 10px 28px rgba(0,0,0,.28);color:var(--dvw-text)}.dvw-branch-current{padding:4px 8px;color:var(--dvw-text-3);font-size:11px}.dvw-branch-list{max-height:min(300px,45vh);overflow:auto}.dvw-branch-list button{width:100%;height:26px;display:flex;align-items:center;gap:6px;border:0;border-radius:4px;background:transparent;color:var(--dvw-text);padding:0 8px;text-align:left;font:inherit;cursor:pointer}.dvw-branch-list button:hover{background:var(--dvw-hover)}.dvw-branch-list button[data-active=true]{background:var(--dvw-active)}.dvw-branch-list button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvw-branch-worktree{margin-left:auto;flex:none;padding:1px 5px;border-radius:8px;background:var(--dvw-surface-3);color:var(--dvw-text-3);font-size:10px;line-height:14px}.dvw-branch-create{display:flex;gap:4px;align-items:center;margin-top:4px;padding-top:6px;border-top:1px solid var(--dvw-border-soft)}.dvw-branch-create .dvw-input{flex:1;min-width:0}.dvw-branch-create-button{flex:none;width:24px;min-width:24px;height:24px;border:1px solid var(--dvw-border);border-radius:4px}.dvw-commit{display:flex;flex-direction:column;gap:6px;padding:9px}.dvw-commit-actions{display:grid;grid-template-columns:1fr auto;gap:6px}.dvw-commit-button{height:31px;border:0;border-radius:6px;background:color-mix(in srgb,var(--dvw-accent) 24%,var(--dvw-surface-2));color:var(--dvw-text);display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer}.dvw-commit-button:hover{background:color-mix(in srgb,var(--dvw-accent) 34%,var(--dvw-surface-2))}.dvw-commit-button:disabled{opacity:.45;cursor:default}.dvw-commit-ai{height:31px;border:1px solid var(--dvw-border);border-radius:6px;background:var(--dvw-surface-2);color:var(--dvw-text-2);display:flex;align-items:center;justify-content:center;gap:6px;font:inherit;cursor:pointer}.dvw-commit-ai:hover:not(:disabled){background:var(--dvw-hover);color:var(--dvw-text)}.dvw-commit-ai:disabled{opacity:.45;cursor:default}.dvw-group-head{height:30px;display:flex;align-items:center;gap:5px;padding:0 6px 0 9px;font-weight:600;position:sticky;top:0;background:var(--dvw-side);z-index:1}.dvw-group-head:hover{background:var(--dvw-hover)}.dvw-group-head .dvw-count{margin-left:auto;min-width:20px;height:20px;border-radius:10px;display:grid;place-items:center;background:var(--dvw-surface-3);color:var(--dvw-text-2);font-size:11px}.dvw-change{display:flex;align-items:center;height:22px;padding:0 5px 0 19px;gap:5px;cursor:pointer}.dvw-change:hover{background:var(--dvw-hover)}.dvw-change .dvw-icon{opacity:0}.dvw-change:hover .dvw-icon,.dvw-change:focus-within .dvw-icon{opacity:1}.dvw-change-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.dvw-badge{font-size:11px;color:var(--dvw-warn)}.dvw-graph{border-top:1px solid var(--dvw-border-soft);margin-top:8px;padding-top:3px}.dvw-graph-list{padding-bottom:8px}.dvw-graph-row{width:100%;border:0;background:transparent;color:var(--dvw-text);display:flex;align-items:center;padding:0 7px;text-align:left;cursor:pointer;overflow:hidden}.dvw-graph-row:hover{background:var(--dvw-hover)}.dvw-graph-svg{flex:none;align-self:stretch}.dvw-graph-line{fill:none;stroke-width:1px;stroke-linecap:round;vector-effect:non-scaling-stroke}.dvw-graph-node{stroke:var(--dvw-side);stroke-width:2px;fill:var(--dvw-side)}.dvw-graph-copy{display:flex;align-items:baseline;gap:6px;min-width:0;flex:1}.dvw-graph-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvw-ref{max-width:82px;margin-left:4px;padding:1px 5px;border:1px solid color-mix(in srgb,var(--dvw-accent) 50%,transparent);border-radius:9px;color:var(--dvw-accent);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvw-error{padding:8px;color:var(--dvw-error);white-space:pre-wrap}.dvw-diff{margin:0;height:100%;overflow:auto;padding:8px 0;background:var(--dvw-surface-1);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}.dvw-diff-line{display:block;min-height:18px;padding:0 14px}.dvw-diff-line.add{background:color-mix(in srgb,var(--dvw-success) 15%,transparent);color:var(--dvw-success)}.dvw-diff-line.remove{background:color-mix(in srgb,var(--dvw-error) 13%,transparent);color:var(--dvw-error)}.dvw-diff-line.hunk{background:color-mix(in srgb,var(--dvw-accent) 12%,transparent);color:var(--dvw-accent)}.dvw-diff-line.meta{color:var(--dvw-text-3)}.dvw-diff-empty{padding:24px;color:var(--dvw-text-3)}
.dvw-git-tools{width:min(860px,calc(100vw - 40px));max-height:85vh;overflow:auto;padding:0;border:1px solid var(--dvw-border);border-radius:10px;background:var(--dvw-base);color:var(--dvw-text);font:inherit}
.dvw-git-tools::backdrop{background:#0007}
.dvw-git-tools>header,.dvw-git-tools>nav{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--dvw-border);flex-wrap:wrap}
.dvw-git-tools>header{justify-content:space-between}
.dvw-git-tools h2,.dvw-git-tools h3{margin:0}
.dvw-git-tools h2{font-size:16px}
.dvw-git-tools h3{font-size:14px}
.dvw-git-tools button:not(.dvw-icon){border:1px solid var(--dvw-border);background:var(--dvw-base);color:inherit;border-radius:5px;padding:5px 9px;cursor:pointer;font:inherit}
.dvw-git-tools button:hover:not(:disabled),.dvw-git-tools button[aria-pressed=true]{background:var(--dvw-hover)}
.dvw-git-tools button:disabled{opacity:.5;cursor:default}
.dvw-git-tool-body{padding:14px 16px;overflow-wrap:anywhere}
.dvw-git-tool-body form,.dvw-git-tool-actions{display:flex;align-items:end;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.dvw-git-tool-body label{display:grid;gap:4px}
.dvw-git-tool-list{list-style:none;padding:0;margin:8px 0}
.dvw-git-tool-list>li>button{text-align:left;width:100%;margin-bottom:4px}
.dvw-git-tool-list small{display:block;color:var(--dvw-text-3)}
.dvw-git-history{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}
.dvw-git-history>.dvw-input,.dvw-git-history input{width:100%;box-sizing:border-box}
.dvw-git-stash{padding:9px 0;border-bottom:1px solid var(--dvw-border)}
.dvw-git-stash .dvw-git-tool-actions{margin:6px 0 0}
.dvw-git-tool-error{color:var(--dvw-text);border-left:3px solid #c75454;padding-left:8px;white-space:pre-wrap}
.dvw-git-blame{max-height:54vh;overflow:auto}
.dvw-git-merge{border-top:1px solid var(--dvw-border);padding-top:8px}
.dvw-git-merge form{display:block}
.dvw-git-merge-sources{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0}
.dvw-git-merge-sources>section{padding:6px;border:1px solid var(--dvw-border)}
.dvw-git-merge-sources pre{height:118px;overflow:auto;white-space:pre}
.dvw-git-merge textarea{height:auto;resize:vertical;font-family:monospace;padding:6px;white-space:pre}
.dvw-git-merge form>button{margin-top:8px}
.dvw-git-diff-view{position:absolute;inset:0;display:flex;flex-direction:column;min-width:0;min-height:0}
.dvw-git-diff-view{container-type:inline-size;--dvw-diff-gap:clamp(20px,3.5cqw,46px)}
.dvw-git-diff-bar{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(max-content,1fr);align-items:center;gap:8px;flex:none;height:35px;padding:0 6px 0 8px;border-bottom:1px solid var(--dvw-border);font-size:12px}
.dvw-git-diff-view[data-jetbrains=true]:has(.dvw-monaco-diff[data-mode=split]) .dvw-git-diff-bar{grid-template-columns:minmax(0,min(calc((100% + var(--dvw-diff-gap) - 14px)/2 - 8px),55%)) auto minmax(max-content,1fr)}
.dvw-git-diff-revisions,.dvw-git-diff-from,.dvw-git-diff-actions{display:flex;align-items:center;white-space:nowrap}
.dvw-git-diff-revisions{min-width:0;gap:8px}
.dvw-git-diff-from{gap:4px}
.dvw-git-diff-from .codicon,.dvw-git-diff-path,.dvw-git-diff-count{color:var(--dvw-text-3)}
.dvw-git-diff-path{overflow:hidden;text-overflow:ellipsis}
.dvw-git-diff-actions{justify-content:flex-end;gap:2px}
.dvw-git-diff-actions .dvw-icon{flex:none;width:23px;height:23px;justify-content:center;padding:0;border-radius:4px}
.dvw-git-diff-actions .dvw-icon:disabled{opacity:.42}
.dvw-git-diff-actions .dvw-mode-button[aria-pressed=true]{background:var(--dvw-active);color:var(--dvw-text)}
.dvw-git-diff-actions .dvw-diff-mode-button:first-of-type{margin-inline-start:2px}
.dvw-git-diff-lines{display:flex;gap:5px;padding-inline:2px 5px;font-variant-numeric:tabular-nums}
.dvw-git-diff-lines>span:first-child{color:var(--dvw-diff-add,#247e64)}
.dvw-git-diff-lines>span:last-child{color:var(--dvw-diff-remove,#b84852)}
.dvw-git-diff-count{font-variant-numeric:tabular-nums}
@container (max-width:560px){
  .dvw-git-diff-view .dvw-git-diff-bar,.dvw-git-diff-view[data-jetbrains=true]:has(.dvw-monaco-diff[data-mode=split]) .dvw-git-diff-bar{grid-template-columns:minmax(0,1fr) auto;gap:4px;padding-inline:4px}
  .dvw-git-diff-path,.dvw-git-diff-to,.dvw-git-diff-lines{display:none}
  .dvw-git-diff-actions .dvw-diff-preview-switch .dvw-mode-button{font-size:0;padding-inline:4px}
}
.dvw-git-diff-body{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden}
.dvw-monaco-diff .monaco-editor :is(.char-insert,.char-delete){background-color:transparent}
.dvw-git-diff-view[data-jetbrains=true] .monaco-editor .diagonal-fill{background:color-mix(in srgb,var(--dvw-side) 60%,transparent)}
.dvw-git-diff-view[data-jetbrains=true] .diff-hidden-lines-widget .center{font-size:11px;box-shadow:none}
.dvw-git-diff-view[data-jetbrains=true] .diff-hidden-lines-widget .breadcrumb-item,
.dvw-git-diff-view[data-jetbrains=true] .diff-hidden-lines-widget .center span[title]+span{display:none!important}
.dvw-monaco-diff[data-compute-only=true]{inset:0 auto auto 0;width:1px;height:1px;visibility:hidden;pointer-events:none}
.dvw-diff-parallax{position:absolute;inset:0;display:grid;grid-template-columns:minmax(0,1fr) var(--dvw-diff-gap) minmax(0,1fr) 14px;background:var(--dvw-diff-surface)}
.dvw-diff-parallax-pane{position:relative;z-index:1;min-width:0;min-height:0;overflow:hidden}
.dvw-diff-parallax-pane>.monaco-editor,
.dvw-diff-parallax-pane>.monaco-editor>.overflow-guard>:is(.margin,.monaco-editor-background),
.dvw-diff-parallax-pane>.monaco-editor>.overflow-guard>.monaco-scrollable-element>.monaco-editor-background{background-color:transparent}
.dvw-diff-parallax-pane>.monaco-editor{outline:none}
.dvw-diff-parallax-pane>.monaco-editor:focus-within{box-shadow:inset 0 1px var(--vscode-focusBorder),inset 0 -1px var(--vscode-focusBorder)}
.dvw-diff-ribbons{position:relative;width:100%;height:100%;pointer-events:none;overflow:visible}
.dvw-diff-ribbons path{fill:var(--dvw-diff-modified)}
.dvw-diff-ribbons path[data-change=added]{fill:var(--dvw-diff-inserted)}
.dvw-diff-ribbons path[data-change=deleted]{fill:var(--dvw-diff-deleted)}
.dvw-diff-ribbons path[data-change=fold]{fill:var(--dvw-diff-fold)}
.dvw-diff-hunk-controls{position:absolute;inset:0;z-index:3;overflow:hidden;pointer-events:none}
.dvw-diff-hunk-actions{position:absolute;display:flex;flex-direction:column;gap:3px;padding:3px;transform:translate(-50%,-50%);border:1px solid color-mix(in srgb,var(--dvw-border) 86%,transparent);border-radius:999px;background:color-mix(in srgb,var(--dvw-surface-1) 94%,transparent);box-shadow:0 3px 12px rgba(0,0,0,.16);pointer-events:auto}
.dvw-diff-hunk-actions::before{content:"";position:absolute;inset:-12px -36px;pointer-events:none}
.dvw-diff-hunk-actions[hidden]{display:none}
.dvw-diff-hunk-actions button{width:22px;height:22px;display:grid;place-items:center;padding:0;border:1px solid color-mix(in srgb,var(--dvw-border) 82%,transparent);border-radius:50%;background:color-mix(in srgb,var(--dvw-surface-1) 92%,transparent);color:var(--dvw-text-2);font:inherit;cursor:pointer}
.dvw-diff-hunk-actions button[data-action=ask]{border-color:color-mix(in srgb,var(--dvw-accent) 46%,var(--dvw-border));color:var(--dvw-accent)}
.dvw-diff-hunk-actions button:hover:not(:disabled){transform:scale(1.08);background:var(--dvw-hover);color:var(--dvw-text)}
.dvw-diff-hunk-actions button:disabled{opacity:.45;cursor:default}
.dvw-git-diff-view[data-jetbrains=true]{--dvw-diff-surface:#fff;--dvw-diff-modified:color-mix(in srgb,${GIT_DIFF_ACCENTS.modified} 21%,var(--dvw-diff-surface));--dvw-diff-inserted:color-mix(in srgb,${GIT_DIFF_ACCENTS.added} 21%,var(--dvw-diff-surface));--dvw-diff-delete-accent:${GIT_DIFF_ACCENTS.deleted};--dvw-diff-deleted:color-mix(in srgb,var(--dvw-diff-delete-accent) 24%,var(--dvw-diff-surface));--dvw-diff-fold:color-mix(in srgb,var(--dvw-text) 7%,var(--dvw-diff-surface))}
.dvw-git-diff-view[data-jetbrains=true][data-theme=dark]{--dvw-diff-surface:#121314;--dvw-diff-delete-accent:#e96777;--dvw-diff-deleted:color-mix(in srgb,var(--dvw-diff-delete-accent) 28%,var(--dvw-diff-surface))}
.dvw-git-diff-view[data-jetbrains=true][data-theme=eyecare]{--dvw-diff-surface:#f7ebc8}
.dvw-git-diff-view[data-jetbrains=true] .dvw-monaco-diff[data-mode=inline] .monaco-editor{
  --vscode-diffEditor-insertedLineBackground:transparent;
  --vscode-diffEditor-removedLineBackground:var(--dvw-diff-deleted);
  --vscode-diffEditorGutter-insertedLineBackground:transparent;
  --vscode-diffEditorGutter-removedLineBackground:transparent
}
.dvw-git-diff-view[data-jetbrains=true] .dvw-monaco-diff[data-mode=inline] .monaco-editor .inline-deleted-margin-view-zone{background-color:var(--dvw-diff-deleted)}
.dvw-git-diff-view[data-jetbrains=true] .dvw-monaco-diff[data-mode=inline] .monaco-editor .dvw-diff-line-modified{background-color:var(--dvw-diff-modified)}
.dvw-diff-line-modified{background:var(--dvw-diff-modified)}
.dvw-diff-line-added{background:var(--dvw-diff-inserted)}
.dvw-diff-line-deleted{background:var(--dvw-diff-deleted)}
.dvw-diff-fold-row{display:block;width:100%;height:20px;padding:0 10px;border:0;text-align:left;color:var(--dvw-text-3);background:transparent;font:11px/20px system-ui;cursor:pointer}
.dvw-diff-fold-row:hover{color:var(--dvw-text)}
.dvw-diff-overview{position:relative;min-height:0}
.dvw-git-line-blame{z-index:4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dvw-text-3);font:11px/18px system-ui;cursor:default}
.dvw-diff-overview input{appearance:none;writing-mode:vertical-lr;direction:ltr;position:absolute;inset:0;width:100%;height:100%;margin:0;background:none;cursor:ns-resize}
.dvw-diff-overview input::-webkit-slider-thumb{appearance:none;width:6px;height:28px;border-radius:3px;background:color-mix(in srgb,var(--dvw-text-3) 52%,transparent)}
.dvw-diff-overview input::-moz-range-thumb{width:6px;height:28px;border:0;border-radius:3px;background:color-mix(in srgb,var(--dvw-text-3) 52%,transparent)}
.dvw-diff-overview input:disabled{opacity:0}
.dvw-diff-overview-marks{position:absolute;inset:0 2px;pointer-events:none}
.dvw-diff-overview-marks i{position:absolute;inset-inline:0;height:3px;background:${GIT_DIFF_ACCENTS.modified}}
.dvw-diff-overview-marks i[data-change=added]{background:${GIT_DIFF_ACCENTS.added}}
.dvw-diff-overview-marks i[data-change=deleted]{background:var(--dvw-diff-delete-accent)}
.dvw-diff-scroll-preview{position:absolute;z-index:4;right:18px;max-width:min(400px,70cqw);width:max-content;padding:8px 10px;border:1px solid var(--dvw-border);border-radius:5px;background:var(--dvw-base);color:var(--dvw-text);white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;font:11px/1.5 monospace;box-shadow:0 2px 10px #0002}
.dvw-tab-list{display:flex;min-width:0;flex:1;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none}.dvw-tab-list::-webkit-scrollbar{display:none}.dvw-monaco-diff{position:absolute;inset:0}.dvw-diff-toolbar{justify-content:flex-end}.dvw-group-head{gap:2px;padding-left:2px}.dvw-group-toggle{min-width:0;height:30px;flex:1;border:0;border-radius:5px;background:transparent;color:var(--dvw-text);font:inherit;font-weight:600;display:flex;align-items:center;gap:5px;padding:0 7px;cursor:pointer;text-align:left}.dvw-group-toggle:hover{background:var(--dvw-hover)}.dvw-graph-entry[data-expanded=true]{background:color-mix(in srgb,var(--dvw-accent) 5%,transparent)}.dvw-commit-files{padding:1px 0 5px 26px}.dvw-commit-file{width:100%;height:22px;border:0;background:transparent;color:var(--dvw-text);display:flex;align-items:center;gap:6px;padding:0 7px;text-align:left;cursor:pointer}.dvw-commit-file:hover{background:var(--dvw-hover)}.dvw-commit-file-name{white-space:nowrap}.dvw-commit-file-dir{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dvw-text-3);font-size:11px}
.dvw-confirm.dvw-rename-preview{width:min(600px,90vw)}.dvw-rename-preview-list{max-height:42vh;overflow:auto;margin:8px 0 12px}.dvw-rename-preview-list details{padding:4px}.dvw-rename-preview-list details>div{display:flex;gap:8px;align-items:baseline;padding:3px 6px;overflow-wrap:anywhere}.dvw-rename-preview-list del,.dvw-rename-preview-list ins{font-family:monospace;white-space:pre-wrap}.dvw-rename-preview-list del{color:var(--dvw-error)}.dvw-rename-preview-list ins{color:var(--dvw-success)}
.dvw-problems{height:100%;overflow:auto;padding:4px 8px;color:var(--dvw-text)}.dvw-problems p{margin:8px}.dvw-problems summary{cursor:pointer;padding:4px 6px}.dvw-problems summary span,.dvw-problems button span:nth-last-child(-n+2):not(:first-of-type){color:var(--dvw-text-3)}.dvw-problems button{display:flex;align-items:baseline;gap:6px;width:100%;padding:3px 6px 3px 24px;border:0;background:none;color:inherit;text-align:left}.dvw-problems button:hover,.dvw-problems button:focus-visible{background:var(--dvw-surface-2)}.dvw-problems button span:first-of-type{overflow-wrap:anywhere}
.dvw-status-problems{display:flex;align-items:center;flex:none;height:22px;gap:8px;padding:0 4px;color:inherit;font:inherit}
.dvw-status-problems>span{display:flex;align-items:center;gap:4px}
.dvw-symbol-outline{max-height:35%;border-top:1px solid var(--dvw-border)}.dvw-symbol-outline>.dvw-outline-head{justify-content:flex-start;gap:4px;width:100%;background:none;border:0;color:inherit;cursor:pointer}.dvw-symbol-outline .dvw-outline-list{min-height:0;overflow:auto}
.dvw-outline{flex:none;max-height:38%;display:flex;flex-direction:column;border-bottom:1px solid var(--dvw-border)}.dvw-outline-head{height:30px;display:flex;align-items:center;justify-content:space-between;padding:0 5px 0 10px;font-weight:600}.dvw-outline-head>span{display:flex;align-items:center;gap:6px}.dvw-outline-list{overflow:auto;padding-bottom:5px}.dvw-outline-item{display:block;width:100%;height:22px;border:0;background:transparent;color:var(--dvw-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;cursor:pointer}.dvw-outline-item:hover{background:var(--dvw-hover);color:var(--dvw-text)}.dvw-document-preview{position:absolute;inset:0;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--dvw-base);color:var(--dvw-text)}
.dvw-preview-header{display:flex;align-items:center;flex:none;gap:8px;min-height:36px;padding:0 12px;border-bottom:1px solid var(--dvw-border);background:var(--dvw-base)}
.dvw-preview-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dvw-text-2)}
.dvw-preview-header>.dvw-icon{flex:none;text-decoration:none;color:var(--dvw-text-2)}
.dvw-preview-header .dvw-open-with{flex:none;position:relative;gap:4px}
.dvw-preview-header .dvw-open-with-note{max-width:180px;font-size:12px}
.dvw-preview-body{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden}
.dvw-preview-status{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;box-sizing:border-box;width:100%;height:100%;min-height:0;padding:24px;color:var(--dvw-text-2);font-size:13px;line-height:1.5;text-align:center;white-space:normal;overflow-wrap:anywhere}
.dvw-preview-retry{display:inline-flex;align-items:center;gap:5px;min-height:28px;padding:3px 10px;border:1px solid var(--dvw-border);border-radius:5px;background:var(--dvw-surface-1);color:var(--dvw-text);font:inherit;cursor:pointer}.dvw-preview-retry:hover{background:var(--dvw-hover)}
.dvw-preview-viewport{position:absolute;inset:0;min-width:0;min-height:0;overflow:hidden}
.dvw-preview-scrollport{width:100%;height:100%;overflow:auto;overscroll-behavior:contain;background:var(--dsw-alias-bg-document-preview,var(--dvw-base))}
.dvw-pdf-preview{display:flex;flex-direction:column;gap:12px;box-sizing:border-box;width:max-content;min-width:100%;min-height:100%;padding:12px}
.dvw-pdf-page{position:relative;flex:none;width:calc(var(--dvw-preview-width) * var(--dvw-preview-zoom));margin-inline:auto;background:#fff;box-shadow:var(--dsw-elevation-prominent,0 2px 10px rgba(0,0,0,.16))}
.dvw-preview-viewport[data-zoom-mode=fit-width] .dvw-pdf-page{width:min(var(--dvw-preview-width),var(--dvw-preview-available))}
.dvw-pdf-page canvas{display:block;width:100%;height:auto}.dvw-pdf-page canvas[hidden]{display:none}.dvw-pdf-page .dvw-preview-status{position:absolute;inset:0;background:var(--dvw-surface-1)}
.dvw-image-preview{display:flex;box-sizing:border-box;width:max-content;min-width:100%;min-height:100%;padding:12px}
.dvw-image-preview img{display:block;flex:none;width:calc(var(--dvw-preview-width) * var(--dvw-preview-zoom));height:auto;max-width:none;max-height:none;margin:auto;border-radius:var(--dsw-radius-md,8px);user-select:none;cursor:grab}.dvw-image-preview img[hidden]{display:none}.dvw-image-preview img[data-panning]{cursor:grabbing}.dvw-image-preview:has(img[hidden]){width:100%;height:100%}
.dvw-preview-controls-zone{position:absolute;inset:auto 0 0;height:72px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:16px;box-sizing:border-box;pointer-events:none}
.dvw-preview-controls{position:relative;display:flex;align-items:center;gap:2px;height:34px;padding:0 5px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,var(--dvw-surface-1));color:var(--dvw-text);box-shadow:var(--dsw-elevation-prominent,0 3px 14px rgba(0,0,0,.18));font-variant-numeric:tabular-nums;opacity:0;pointer-events:none;transition:opacity .12s ease-out}
.dvw-preview-viewport[data-controls-visible] .dvw-preview-controls,.dvw-preview-controls:focus-within,.dvw-preview-controls[data-open=true]{opacity:1;pointer-events:auto}
.dvw-preview-controls .dvw-icon{width:26px;height:26px;border-radius:4px}.dvw-preview-controls button:disabled{opacity:.4;cursor:default}
.dvw-preview-zoom{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:70px;height:26px;padding:0 6px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}.dvw-preview-zoom:hover{background:var(--dvw-hover)}.dvw-preview-zoom .codicon{font-size:12px}
.dvw-preview-zoom-menu{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);display:flex;flex-direction:column;min-width:140px;max-height:min(300px,50vh);overflow:auto;padding:4px;border:1px solid var(--dvw-border);border-radius:6px;background:var(--dvw-surface-1);box-shadow:0 4px 16px rgba(0,0,0,.18);z-index:3}
.dvw-preview-zoom-menu button{flex:none;min-height:28px;padding:3px 10px;border:0;border-radius:3px;background:transparent;color:var(--dvw-text);text-align:left;font:inherit;font-size:12px;cursor:pointer}.dvw-preview-zoom-menu button:hover,.dvw-preview-zoom-menu button[aria-checked=true]{background:var(--dvw-hover)}
.dvw-preview-controls button:focus-visible,.dvw-preview-retry:focus-visible,.dvw-preview-header a:focus-visible{outline:2px solid var(--dvw-accent);outline-offset:1px}
@media(hover:none){.dvw-preview-controls{opacity:1;pointer-events:auto}}@media(prefers-reduced-motion:reduce){.dvw-preview-controls{transition:none}}
.dvw-sheet-preview{position:absolute;inset:0;display:flex;min-height:0;flex-direction:column;background:var(--dvw-base);color:var(--dvw-text)}.dvw-sheet-tabs{flex:none;display:flex;gap:2px;padding:6px 8px;overflow:auto;border-bottom:1px solid var(--dvw-border)}.dvw-sheet-tabs button{height:24px;padding:0 10px;border:0;border-radius:3px;background:transparent;color:var(--dvw-text-2);font:inherit;cursor:pointer;white-space:nowrap}.dvw-sheet-tabs button:hover{background:var(--dvw-hover)}.dvw-sheet-tabs button[data-active=true]{background:var(--dvw-active);color:var(--dvw-text)}.dvw-sheet-scroll{flex:1;min-height:0;overflow:auto;padding:10px}.dvw-sheet-table{border-collapse:collapse;font-size:12px}.dvw-sheet-table td{max-width:360px;padding:2px 8px;border:1px solid var(--dvw-border);white-space:pre;overflow:hidden;text-overflow:ellipsis}.dvw-sheet-table tr:first-child td{background:var(--dvw-hover);font-weight:600}.dvw-slides-preview{position:absolute;inset:0;overflow:auto;padding:16px;background:var(--dvw-base)}.dvw-docx-preview{box-sizing:border-box;min-width:100%;width:max-content;min-height:100%;padding:12px;color:#222}.dvw-docx-preview[hidden]{display:none}.dvw-docx-preview .docx-wrapper{width:max-content;margin-inline:auto;padding:0;background:transparent;zoom:var(--dvw-preview-zoom)}.dvw-docx-preview section.docx{margin-inline:auto;margin-bottom:12px;box-shadow:var(--dsw-elevation-prominent,0 2px 10px rgba(0,0,0,.16))}.dvw-document-error,.dvw-document-download{height:100%;display:grid;place-content:center;justify-items:center;gap:12px;padding:24px;color:var(--dvw-text-2);text-align:center}.dvw-document-download a{color:var(--dvw-accent);text-decoration:none}.dvw-document-download a:hover{text-decoration:underline}
.dvw-markdown{height:100%;overflow:auto;padding:28px clamp(24px,6vw,80px) 60px;color:var(--dvw-text);font-size:15px;line-height:1.65}.dvw-markdown>*:first-child{margin-top:0}.dvw-markdown h1,.dvw-markdown h2{padding-bottom:.3em;border-bottom:1px solid var(--dvw-border)}.dvw-markdown h1{font-size:2em}.dvw-markdown h2{font-size:1.5em}.dvw-markdown h3{font-size:1.25em}.dvw-markdown a{color:var(--dvw-accent)}.dvw-markdown code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--dvw-surface-2);border-radius:4px;padding:.15em .35em}.dvw-markdown pre{overflow:auto;padding:14px;border:1px solid var(--dvw-border-soft);border-radius:7px;background:var(--dvw-base)}.dvw-markdown pre code{padding:0;background:transparent}.dvw-markdown blockquote{margin-left:0;padding-left:14px;border-left:3px solid var(--dvw-border);color:var(--dvw-text-2)}.dvw-markdown table{border-collapse:collapse;display:block;overflow:auto}.dvw-markdown th,.dvw-markdown td{padding:6px 12px;border:1px solid var(--dvw-border)}.dvw-markdown tr:nth-child(2n){background:var(--dvw-hover)}.dvw-markdown img{max-width:100%}.dvw-markdown hr{border:0;border-top:1px solid var(--dvw-border)}
.dvw-sidebar-launcher-mount{border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}.dvw-outline-toggle{margin-right:auto}.dvw-outline-toggle[data-active=true]{background:var(--dvw-active);color:var(--dvw-text)}.dvw-editor-outline{position:absolute;z-index:2;top:35px;bottom:0;left:0;width:240px;max-height:none;background:var(--dvw-surface-1);border-right:1px solid var(--dvw-border);border-bottom:0}.dvw-editor[data-outline=true] .dvw-editor-body{left:240px}.dvw-diff-preview-switch{margin-right:auto;display:flex;gap:4px}.dvw-commit-files{position:relative;padding-top:1px;padding-right:0;padding-bottom:5px}.dvw-graph-continuation{position:absolute;top:0;bottom:0;left:7px;height:100%;pointer-events:none}.dvw-commit-file-list{position:relative;min-width:0}.dvw-overlay button:focus-visible,.dvw-overlay input:focus-visible,.dvw-overlay select:focus-visible{outline:1px solid var(--dvw-accent);outline-offset:-1px}@media(max-width:800px){.dvw-overlay{grid-template-columns:44px var(--dvw-side-width) minmax(0,1fr)}.dvw-editor-outline{width:210px}.dvw-editor[data-outline=true] .dvw-editor-body{left:210px}}
.dvw-overlay[data-dvw-chat=true]{grid-template-columns:48px var(--dvw-side-width) minmax(0,1fr) var(--dvw-chat-width)}
.dvw-overlay:not([data-dvw-primary-side=true]){grid-template-columns:48px 0 minmax(0,1fr)}
.dvw-overlay[data-dvw-chat=true]:not([data-dvw-primary-side=true]){grid-template-columns:48px 0 minmax(0,1fr) var(--dvw-chat-width)}
/* Keep empty groups mounted, so opening a file restores their layout and focus. */
.dvw-overlay[data-dvw-editor-empty=true]>.dvw-main{display:none}
.dvw-overlay[data-dvw-editor-empty=true] .dvw-chat-resizer{display:none}
.dvw-overlay:not([data-dvw-primary-side=true]) .dvw-side{visibility:hidden;border-right:0}.dvw-overlay:not([data-dvw-primary-side=true]) .dvw-activity{border-radius:8px}.dvw-overlay:not([data-dvw-primary-side=true]) .dvw-side-resizer{display:none}
.dvw-overlay:not([data-dvw-status=true]){grid-template-rows:minmax(0,1fr) auto 6px}.dvw-overlay:not([data-dvw-status=true]) .dvw-status{display:none}
.dvw-overlay[data-dvw-chat=true] .dvw-status{grid-column:1/-1}
.dvw-overlay[data-dvw-status=true]:not([data-dvw-float=true]) .dvw-chat-resizer{bottom:30px}
.dvw-chat{grid-column:4;grid-row:1/3;min-width:0;background:var(--dvw-gutter);border-left:1px solid var(--dvw-border);position:relative}
.dvw-chat-head{height:36px;display:flex;align-items:center;justify-content:space-between;padding:0 6px 0 12px;border-bottom:1px solid var(--dvw-border);background:var(--dvw-base);font-weight:600}
.dvw-chat-head>span{display:flex;align-items:center;gap:7px}.dvw-chat-body{height:calc(100% - 36px);background:var(--dvw-base)}
.dvw-dsh-mark{display:block}
.dvw-chat-resizer{position:fixed;top:var(--dvw-titlebar-height);right:calc(var(--dvw-chat-width) - 2px);bottom:0;width:4px;z-index:4;cursor:ew-resize;touch-action:none}
.dvw-chat-resizer:hover,.dvw-chat-resizer:focus-visible,.dvw-chat-resizer[data-dragging=true]{background:var(--dvw-accent)}
.dvw-side-resizer,.dvw-chat-resizer{width:10px;cursor:ew-resize;touch-action:none;background:transparent}
.dvw-side-resizer{position:relative;transform:translateX(7px);z-index:22}
.dvw-chat-resizer{position:fixed;top:var(--dvw-titlebar-height);right:calc(var(--dvw-chat-width) - 5px);z-index:22}
.dvw-side-resizer::after,.dvw-chat-resizer::after{content:"";position:absolute;top:0;bottom:0;left:4px;width:2px;background:var(--dvw-border)}
.dvw-side-resizer:hover,.dvw-side-resizer:focus-visible,.dvw-side-resizer[data-dragging=true],.dvw-chat-resizer:hover,.dvw-chat-resizer:focus-visible,.dvw-chat-resizer[data-dragging=true]{background:transparent}
.dvw-side-resizer:hover::after,.dvw-side-resizer:focus-visible::after,.dvw-side-resizer[data-dragging=true]::after,.dvw-chat-resizer:hover::after,.dvw-chat-resizer:focus-visible::after,.dvw-chat-resizer[data-dragging=true]::after{background:var(--dvw-accent)}
.dvw-chat{border-left-color:transparent!important}
.dvw-side-resizer::after,.dvw-chat-resizer::after{background:transparent;left:3px;width:4px}
.dvw-side-resizer:hover::after,.dvw-side-resizer:focus-visible::after,.dvw-side-resizer[data-dragging=true]::after,.dvw-chat-resizer:hover::after,.dvw-chat-resizer:focus-visible::after,.dvw-chat-resizer[data-dragging=true]::after{background:var(--dvw-accent)}
[data-dvw-conversation-panel]{position:fixed!important;top:calc(var(--dvw-titlebar-height) + 6px)!important;right:3px!important;bottom:var(--dvw-status-height,30px)!important;left:auto!important;width:calc(var(--dvw-chat-width) - 6px)!important;height:auto!important;min-width:0!important;z-index:21!important;border:1px solid var(--dsw-alias-border-l2)!important;border-radius:8px!important;overflow:hidden!important;box-shadow:none!important;box-sizing:border-box!important}
[data-dvw-conversation-panel=""] [data-conversation-content]{font-size:14px}
[data-dvw-conversation-panel=""] [data-conversation-content] pre{font-size:12px}
[data-dvw-conversation-editor]{position:absolute;inset:0}
.dvw-native-conversation{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;min-width:0;overflow:hidden}.dvw-native-conversation-header{position:relative;display:flex;flex-direction:column;flex:none;min-width:0;padding:10px 20px 0;border-bottom:1px solid var(--dsw-alias-border-l3,#333)}
.dvw-native-conversation>[data-conversation-content]{flex:1;min-height:0}
.dvw-sidebar-conversation-title-row{display:flex;align-items:center;gap:12px;min-height:36px}
.dvw-sidebar-conversation-title{display:flex;align-items:center;gap:20px;min-width:0;flex:1}
.dvw-sidebar-conversation-title-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary,#222)}
.dvw-sidebar-conversation-mode{display:flex;align-items:center;gap:6px;flex:none;font-size:13px;color:var(--dsw-alias-label-secondary,#777)}
.dvw-sidebar-conversation-actions{display:flex;align-items:center;gap:8px}
.dvw-sidebar-conversation-tabs{display:flex;align-items:center;gap:32px;min-height:38px;margin-top:4px;border-bottom:1px solid var(--dsw-alias-border-l3,#ddd)}
.dvw-sidebar-conversation-tab{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;height:38px;padding:0 2px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#777);font-size:13px;line-height:16px;font-weight:500;cursor:pointer}
.dvw-sidebar-conversation-tab.is-active{color:var(--dsw-alias-label-primary,#222)}
.dvw-sidebar-conversation-tab.is-active:after{position:absolute;right:0;bottom:-1px;left:0;height:2px;background:var(--dsw-alias-color-primary,#4b73ff);content:""}
.dvw-sidebar-conversation-more{position:relative}
.dvw-sidebar-conversation-visibility-menu{position:absolute;z-index:30;top:100%;right:20px;width:220px;padding:6px;background:var(--dsw-alias-surface-primary,#fff);border:1px solid var(--dsw-alias-border-l3,#ddd);box-shadow:0 4px 14px #0002}
.dvw-conversation-view-settings-anchor{position:relative;flex:none}
.dvw-conversation-view-settings-anchor .dvw-sidebar-conversation-visibility-menu{top:calc(100% + 6px);right:0}
.dvw-sidebar-conversation-visibility-title{display:flex;align-items:center;justify-content:space-between;min-height:30px;padding:0 6px 4px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#222)}
.dvw-sidebar-conversation-visibility-title button{display:grid;place-items:center;width:24px;height:24px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary,#777);cursor:pointer}
.dvw-sidebar-conversation-visibility-menu label{display:flex;align-items:center;gap:8px;min-height:30px;padding:3px 6px;color:var(--dsw-alias-label-primary,#222);font-size:13px;line-height:18px;cursor:pointer}
.dvw-sidebar-conversation-visibility-menu input{margin:0;accent-color:var(--dsw-alias-state-business-primary,#4b73ff)}
.dvw-sidebar-conversation-menu{position:absolute;z-index:20;top:100%;right:0;min-width:180px;padding:4px;background:var(--dsw-alias-surface-primary,#fff);border:1px solid var(--dsw-alias-border-l3,#ddd);box-shadow:0 4px 14px #0002}
.dvw-sidebar-conversation-menu-row{display:flex;align-items:center;justify-content:space-between}
.dvw-sidebar-conversation-menu-row button{padding:6px 8px;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}
.dvw-official-conversation-action{display:none;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#777);cursor:pointer;-webkit-app-region:no-drag}
[data-dvw-conversation-panel] .dvw-official-conversation-action,[data-dvw-native-sidebar] .dvw-official-conversation-action,.dvw-native-conversation .dvw-official-conversation-action{display:inline-grid}
.dvw-official-conversation-action:hover{background:var(--dsw-alias-interactive-bg-hover,#8882);color:var(--dsw-alias-label-primary,#ccc)}
.dvw-official-conversation-action svg{width:16px;height:16px;flex:none}
.dvw-official-conversation-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:-2px}
/* Keep DSH's history-aware turn rail available in narrow workbench conversations. */
nav[data-dvw-turn-navigation=on]{display:block;left:6px;right:auto;width:28px;-webkit-app-region:no-drag}
nav[data-dvw-turn-navigation=off]{display:none}
nav[data-dvw-turn-navigation=on] button[data-index]::before{left:0;right:auto;transform-origin:left center}
nav[data-dvw-turn-navigation=on] button[data-index]::after{left:0;right:auto}
nav[data-dvw-turn-navigation=on] [role=tooltip]{left:calc(100% + 8px);right:auto;width:min(360px,calc(100cqw - 44px))}
[data-dvw-turn-navigation-slot=on]+div>div:first-child{padding-inline-start:max(42px,calc(var(--dsh-composer-side-clearance,0px) + 16px))}
body[data-dvw-workbench-active] [data-dvw-conversation-panel=editor][data-phase],[data-dvw-conversation-panel=editor]{right:auto!important;bottom:auto!important;border:0!important;border-radius:0!important;max-width:none!important;max-height:none!important;margin:0!important;box-sizing:border-box!important}
body[data-dvw-editor-dragging] [data-dvw-conversation-panel]{pointer-events:none!important}
html[data-platform=darwin] [data-dvw-conversation-panel]{top:var(--dvw-titlebar-height)!important}
body[data-dvw-palette=light] [data-dvw-conversation-panel]{--dsw-alias-bg-base:#fff;--dsw-specific-sidebar-fill:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-layer-3:#fff;--dsw-alias-border-l2:#e2e2e2;--dsw-alias-border-l3:#efefef;background:#fff!important}
body[data-dvw-palette=dark] [data-dvw-conversation-panel]{--dsw-alias-bg-base:#191a1b;--dsw-specific-sidebar-fill:#191a1b;--dsw-alias-bg-layer-1:#202122;--dsw-alias-bg-layer-2:#252526;--dsw-alias-bg-layer-3:#2a2b2c;--dsw-alias-label-primary:#bfbfbf;--dsw-alias-label-secondary:#8c8c8c;--dsw-alias-label-tertiary:#6e6e6e;--dsw-alias-border-l2:#2a2b2c;--dsw-alias-border-l3:#303132;--dsw-alias-interactive-bg-hover:#ffffff12;--dsw-alias-interactive-bg-active:#ffffff1f}
/* Lower only background docks. Isolating the whole column traps terminals
   dragged into native floats behind the workbench when their dock is dismissed. */
[data-rightbar-col]:not([data-dvw-native-sidebar]):has(~ [data-shell-overlay] .dvw-overlay) [data-sidebar-right-panel]{--dsh-dockkit-dock-layer:10}
[data-rightbar-col][data-dvw-native-sidebar] :is([data-sidebar-right-mode],[data-sidebar-right-toggle]),
[data-rightbar-col][data-dvw-native-sidebar] ~ [data-side=rightbar]{-webkit-app-region:no-drag}
[data-rightbar-col][data-dvw-native-sidebar=fullscreen] ~ [data-shell-overlay] .dvw-titlebar{-webkit-app-region:no-drag}
/* Lift the native dock and reserve its full push width in the embedded workbench. */
[data-rightbar-col][data-dvw-native-sidebar]{z-index:21}
[data-rightbar-col][data-dvw-native-sidebar] ~ [data-side=rightbar]{z-index:22}
/* The workbench reserves the full dock width at once. With chat closed, show
   the dock in place so its slide cannot expose the resident conversation.
   Use render visibility; placement effects release their body marker on resize. */
body[data-dvw-workbench-active] [data-animating]:has(> [data-rightbar-col][data-dvw-native-sidebar]):has(> [data-shell-overlay] .dvw-overlay[data-dvw-conversation=false]:not([data-dvw-float=true])),
body[data-dvw-workbench-active] [data-rightbar-col][data-dvw-native-sidebar]:has(~ [data-shell-overlay] .dvw-overlay[data-dvw-conversation=false]:not([data-dvw-float=true])) [data-sidebar-right-open=true] :is([data-dockkit-host=dock],[data-dockkit-empty],[data-dockkit-divider]){transition:none!important}
body[data-dvw-workbench-active] .dvw-overlay:not([data-dvw-float=true]){right:var(--dvw-native-sidebar-width,0px)}
body[data-dvw-workbench-active] [data-dvw-conversation-panel]{right:calc(3px + var(--dvw-native-sidebar-width,0px))!important}
body[data-dvw-workbench-active] .dvw-chat-resizer{right:calc(var(--dvw-chat-width) - 5px + var(--dvw-native-sidebar-width,0px))}
body[data-dvw-workbench-active] [data-sidebar-right-expand],body[data-dvw-conversation-active] [data-sidebar-right-expand]{display:none!important}
body[data-dvw-workbench-active] [data-shell-leading]{display:none!important}
body[data-dvw-workbench-active] [data-sidebar-toggle]{display:none!important}
.dvw-workspace-switcher{width:min(560px,calc(100vw - 48px));max-height:min(640px,calc(100vh - 80px));display:flex;flex-direction:column;border:1px solid var(--dvw-border);border-radius:8px;background:var(--dvw-surface-2);box-shadow:0 12px 36px rgba(0,0,0,.34)}.dvw-workspace-switcher>header{height:44px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 8px 0 14px;border-bottom:1px solid var(--dvw-border)}.dvw-workspace-switcher h2{margin:0;font-size:14px;font-weight:600}.dvw-workspace-list{flex:1;min-height:0;overflow:auto;padding:6px}.dvw-workspace-row{display:flex;align-items:center;gap:4px;border-radius:5px}.dvw-workspace-row:hover{background:var(--dvw-hover)}.dvw-workspace-toggle{min-width:0;flex:1;display:flex;align-items:center;gap:8px;height:34px;padding:0 8px;border:0;background:transparent;color:var(--dvw-text);font:inherit;text-align:left;cursor:pointer}.dvw-workspace-title{font-weight:600;white-space:nowrap}.dvw-workspace-path{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dvw-text-3);font-size:11px}.dvw-workspace-enter{opacity:0}.dvw-workspace-row:hover .dvw-workspace-enter,.dvw-workspace-row:focus-within .dvw-workspace-enter{opacity:1}.dvw-workspace-sessions{display:flex;flex-direction:column;gap:1px;padding:2px 0 6px 26px}.dvw-workspace-session{display:flex;align-items:center;gap:7px;height:28px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:var(--dvw-text);font:inherit;text-align:left;cursor:pointer}.dvw-workspace-session:hover{background:var(--dvw-hover)}.dvw-workspace-session[data-active=true]{background:var(--dvw-active)}.dvw-workspace-session-title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvw-workspace-current{padding:0 6px;border-radius:8px;background:color-mix(in srgb,var(--dvw-accent) 18%,transparent);color:var(--dvw-accent);font-size:11px}.dvw-workspace-empty{margin:6px 8px;color:var(--dvw-text-3);font-size:12px}.dvw-workspace-error{margin:0;padding:6px 14px;color:var(--dvw-error);font-size:12px}.dvw-workspace-switcher>footer{flex:none;display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--dvw-border)}.dvw-workspace-switcher>footer button{height:28px;padding:0 12px;border:1px solid var(--dvw-border);border-radius:4px;background:var(--dvw-surface-3);color:var(--dvw-text);font:inherit;cursor:pointer}.dvw-workspace-switcher>footer button:hover:not(:disabled){background:var(--dvw-hover)}.dvw-workspace-switcher>footer button.dvw-primary-button{border-color:var(--dvw-accent);background:var(--dvw-accent);color:#fff}.dvw-confirm-backdrop{position:fixed;z-index:50;inset:0;display:grid;place-items:center;padding:24px;background:rgba(0,0,0,.38)}.dvw-confirm{width:min(380px,calc(100vw - 48px));border:1px solid var(--dvw-border);border-radius:7px;background:var(--dvw-surface-2);box-shadow:0 12px 36px rgba(0,0,0,.34);padding:18px}.dvw-confirm h2{margin:0 0 12px;font-size:15px}.dvw-confirm p{margin:0;color:var(--dvw-text)}.dvw-confirm-note{margin-top:8px!important;color:var(--dvw-text-3)!important;font-size:12px}.dvw-confirm .dvw-branch-error-message{max-height:240px;overflow:auto;white-space:pre-wrap;color:var(--dvw-error);font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.dvw-confirm footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.dvw-confirm footer button{height:28px;border:1px solid var(--dvw-border);border-radius:2px;background:var(--dvw-surface-3);color:var(--dvw-text);padding:0 12px;font:inherit;cursor:pointer}.dvw-confirm footer button:hover{background:var(--dvw-hover)}.dvw-confirm footer .dvw-danger-button{border-color:color-mix(in srgb,var(--dvw-error) 65%,var(--dvw-border));background:var(--dvw-error);color:#fff}.dvw-confirm footer .dvw-danger-button:hover{background:color-mix(in srgb,var(--dvw-error) 82%,#000)}
.dvw-git-dialog-layer{--dvw-surface-1:var(--dsw-alias-bg-layer-1,#fff);--dvw-surface-2:var(--dsw-alias-bg-layer-2,#fff);--dvw-surface-3:var(--dsw-alias-bg-layer-3,#f5f6f7);--dvw-text:var(--dsw-alias-label-primary,#171717);--dvw-text-2:var(--dsw-alias-label-secondary,#5c5c5c);--dvw-text-3:var(--dsw-alias-label-tertiary,#8c8c8c);--dvw-border:var(--dsw-alias-border-l2,#dedede);--dvw-border-soft:var(--dsw-alias-border-l3,#ececec);--dvw-accent:var(--dsw-alias-state-business-primary,#3b82f6);--dvw-warn:var(--dsw-alias-state-warn-primary,#c69026);--dvw-hover:var(--dsw-alias-interactive-bg-hover,#0000000c);position:fixed!important;z-index:250!important;inset:0;display:grid;place-items:center;padding:24px;background:rgba(0,0,0,.46);color:var(--dvw-text);font:13px/1.4 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}
.dvw-git-error-dialog{width:min(440px,calc(100vw - 48px));padding:20px;color:var(--dvw-text);background:var(--dvw-surface-2);border-color:var(--dvw-border);box-shadow:0 18px 52px rgba(0,0,0,.32)}
.dvw-git-error-head{display:flex;align-items:flex-start;gap:12px}
.dvw-git-error-mark{width:32px;height:32px;flex:none;display:grid;place-items:center;border-radius:9px;background:color-mix(in srgb,var(--dvw-warn) 14%,var(--dvw-surface-3));color:var(--dvw-warn);font-size:17px}
.dvw-git-error-head>div{min-width:0}
.dvw-git-error-dialog h2{margin:1px 0 6px;font-size:15px;line-height:1.35}
.dvw-git-error-dialog p{color:var(--dvw-text-2);font-size:12px;line-height:1.65}
.dvw-git-error-detail{margin-top:14px;border:1px solid var(--dvw-border-soft);border-radius:7px;background:var(--dvw-surface-1)}
.dvw-git-error-detail summary{padding:8px 10px;color:var(--dvw-text-2);font-size:11px;cursor:pointer;user-select:none}
.dvw-git-error-detail pre{max-height:180px;margin:0;padding:0 10px 10px;overflow:auto;color:var(--dvw-text-3);font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.dvw-git-error-dialog footer{align-items:center;margin-top:18px}
.dvw-git-error-dialog footer button{border-radius:6px;padding-inline:14px}
.dvw-git-error-dialog footer .dvw-git-error-primary{border-color:var(--dvw-accent);background:var(--dvw-accent);color:#fff;font-weight:600}
.dvw-git-error-dialog footer .dvw-git-error-primary:hover{background:color-mix(in srgb,var(--dvw-accent) 84%,#000);color:#fff}
@media(max-width:520px){.dvw-git-error-dialog{width:calc(100vw - 28px);padding:16px}.dvw-git-error-dialog footer{flex-wrap:wrap}}
.dvw-tree:focus{outline:none}.dvw-context-menu kbd{margin-left:auto;padding-left:18px;font:inherit;font-size:11px;color:var(--dvw-text-3)}.dvw-tree[data-dvw-native-drop-target=true]{outline:1px dashed var(--dvw-accent);outline-offset:-3px}.dvw-tree-row[data-dvw-native-drop-target=true]{background:var(--dvw-active)}.dvw-tree-entry[data-dvw-move-target=true],.dvw-tree[data-dvw-move-target=true]{background:var(--dvw-hover)}
.dvw-act:disabled{opacity:.4;cursor:not-allowed}
.dvw-terminal-root{height:100%;display:flex;flex-direction:column;background:var(--dvw-base);color:var(--dvw-text)}.dvw-terminal-tabs{height:28px;display:flex;align-items:center;padding:0 8px;gap:3px;border-bottom:1px solid var(--dvw-border-soft)}.dvw-terminal-tab{height:24px;max-width:180px;border:0;background:transparent;color:var(--dvw-text-2);padding:0 9px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dvw-terminal-tab[data-active=true]{color:var(--dvw-text);background:var(--dvw-active)}.dvw-terminal-actions{margin-left:auto;display:flex}.dvw-terminal-button{width:28px;height:24px;border:0;background:transparent;color:var(--dvw-text-2);cursor:pointer;font:18px/1 inherit}.dvw-terminal-button:hover{background:var(--dvw-hover);color:var(--dvw-text)}.dvw-terminal-button:disabled{opacity:.4;cursor:default}.dvw-terminal-host{position:relative;flex:1;min-height:0;padding:5px 8px;background:var(--dvw-base)}.dvw-terminal-host .xterm{height:100%;position:relative;user-select:none}.dvw-terminal-host .xterm.focus,.dvw-terminal-host .xterm:focus{outline:none}.dvw-terminal-host .xterm-viewport{position:absolute;inset:0;overflow-y:scroll;background-color:transparent}.dvw-terminal-host .xterm-screen{position:relative}.dvw-terminal-host .xterm-helpers{position:absolute;top:0;z-index:5}.dvw-terminal-host .xterm-helper-textarea{position:absolute;opacity:0;left:-9999em;top:0;width:0;height:0;z-index:-5;white-space:nowrap;overflow:hidden;resize:none}.dvw-terminal-host .composition-view{background:var(--dvw-base);color:var(--dvw-text);display:none;position:absolute;white-space:nowrap;z-index:1}.dvw-terminal-host .composition-view.active{display:block}.dvw-terminal-host .xterm-char-measure-element{display:inline-block;visibility:hidden;position:absolute;left:-9999em;line-height:normal}.dvw-terminal-host .xterm-cursor-pointer,.dvw-terminal-host .xterm .xterm-cursor-pointer{cursor:pointer}.dvw-terminal-host .xterm-accessibility,.dvw-terminal-host .xterm-message{position:absolute;inset:0;z-index:10;color:transparent;pointer-events:none}.dvw-terminal-host .xterm-accessibility-tree{position:absolute;left:0;top:0;width:100%}.dvw-terminal-host .xterm-accessibility-tree>div{position:absolute;transform-origin:top left}.dvw-terminal-host canvas{position:absolute;left:0;top:0}.dvw-terminal-error{padding:8px;color:var(--dvw-error)}
.dvw-terminal-tabs{height:35px;padding:0 10px;gap:2px;background:var(--dvw-base)}.dvw-terminal-tab{height:28px;display:flex;align-items:center;gap:6px;border-radius:3px;padding:0 10px;font:inherit}.dvw-terminal-tab .codicon{font-size:14px}.dvw-terminal-tab[data-active=true]{box-shadow:inset 0 1px 0 var(--dvw-accent)}.dvw-terminal-button{height:28px;font:inherit;display:grid;place-items:center;border-radius:3px}.dvw-terminal-host{padding:8px 10px}
.dvw-terminal-root{flex-direction:row}.dvw-terminal-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}.dvw-terminal-main>.dvw-terminal-host{flex:1;min-height:0}.dvw-terminal-tabs{width:220px;height:auto;flex:none;display:flex;flex-direction:column;align-items:stretch;padding:0;border-left:1px solid var(--dvw-border);border-bottom:0;background:var(--dvw-base)}.dvw-terminal-actions{height:35px;flex:none;margin-left:0;justify-content:flex-end;align-items:center;padding:0 6px;border-bottom:1px solid var(--dvw-border-soft)}.dvw-terminal-list{min-height:0;overflow:auto;padding:4px}.dvw-terminal-tab{width:100%;max-width:none;justify-content:flex-start;height:22px;border-radius:3px;color:var(--dvw-text-2)}.dvw-terminal-tab[data-active=true]{background:var(--dvw-active);color:var(--dvw-text);box-shadow:inset 2px 0 0 var(--dvw-accent)}
.dvw-terminal-rename{width:100%;min-width:0;height:22px;border:1px solid var(--dvw-accent);border-radius:2px;background:var(--dvw-base);color:var(--dvw-text);padding:0 4px;font:inherit;outline:0}.dvw-terminal-menu{position:fixed;z-index:60;min-width:140px;padding:4px;border:1px solid var(--dvw-border);border-radius:5px;background:var(--dvw-surface-3);box-shadow:0 6px 20px rgba(0,0,0,.3)}.dvw-terminal-menu button{display:block;width:100%;height:28px;border:0;border-radius:3px;background:transparent;color:var(--dvw-text);padding:0 10px;text-align:left;font:inherit;cursor:pointer}.dvw-terminal-menu button:hover{background:var(--dvw-hover)}.dvw-terminal-menu .dvw-terminal-menu-danger{color:var(--dvw-error)}
.dvw-terminal-panes{flex:1;min-height:0;display:flex}.dvw-terminal-panes>.dvw-terminal-host{flex:1;min-width:0}.dvw-terminal-panes[data-split=true]>.dvw-terminal-host+.dvw-terminal-host{border-left:1px solid var(--dvw-border)}.dvw-terminal-resizer{width:4px;flex:none;cursor:ew-resize;position:relative;z-index:1}.dvw-terminal-resizer:hover{background:var(--dvw-accent)}.dvw-terminal-entry{position:relative;display:flex;align-items:center;min-width:0}.dvw-terminal-entry .dvw-terminal-tab{padding-right:58px}.dvw-terminal-entry-actions{position:absolute;right:4px;top:0;height:22px;display:none;align-items:center;background:var(--dvw-active)}.dvw-terminal-entry:hover .dvw-terminal-entry-actions,.dvw-terminal-entry:focus-within .dvw-terminal-entry-actions{display:flex}.dvw-terminal-entry-actions button{width:25px;height:28px;display:grid;place-items:center;border:0;border-radius:3px;background:transparent;color:var(--dvw-text-2);cursor:pointer}.dvw-terminal-entry-actions button:hover{background:var(--dvw-hover);color:var(--dvw-text)}
.dvw-terminal-list,.dvw-terminal-host .xterm-viewport{scrollbar-width:none}.dvw-terminal-list::-webkit-scrollbar,.dvw-terminal-host .xterm-viewport::-webkit-scrollbar{display:none}
/* 官方 xterm.css 的必备规则：选区层是不透明的，只有 .xterm-decoration-top 把选中文字抬到它上面，否则文字会被整条盖住。 */
.dvw-terminal-host .xterm-scroll-area{visibility:hidden}.dvw-terminal-host .xterm-decoration-top{z-index:2;position:relative}.dvw-terminal-host .xterm-dim{opacity:1!important}.dvw-terminal-host .xterm-underline-1{text-decoration:underline}.dvw-terminal-host .xterm-underline-2{text-decoration:double underline}.dvw-terminal-host .xterm-underline-3{text-decoration:wavy underline}.dvw-terminal-host .xterm-underline-4{text-decoration:dotted underline}.dvw-terminal-host .xterm-underline-5{text-decoration:dashed underline}.dvw-terminal-host .xterm-overline{text-decoration:overline}.dvw-terminal-host .xterm-overline.xterm-underline-1{text-decoration:overline underline}.dvw-terminal-host .xterm-overline.xterm-underline-2{text-decoration:overline double underline}.dvw-terminal-host .xterm-overline.xterm-underline-3{text-decoration:overline wavy underline}.dvw-terminal-host .xterm-overline.xterm-underline-4{text-decoration:overline dotted underline}.dvw-terminal-host .xterm-overline.xterm-underline-5{text-decoration:overline dashed underline}.dvw-terminal-host .xterm-strikethrough{text-decoration:line-through}.dvw-terminal-host .xterm.enable-mouse-events{cursor:default}.dvw-terminal-host .xterm.column-select.focus{cursor:crosshair}.dvw-terminal-host .xterm-accessibility-tree:not(.debug) *::selection{color:transparent}.dvw-terminal-menu button:disabled{opacity:.45;cursor:default}.dvw-terminal-menu button:disabled:hover{background:transparent}
/* Slightly larger explorer rows for comfortable reading without shrinking the file list. */
.dvw-tree-row{height:24px;font-size:14px}
.dvw-tree .dvw-file-icon{width:19px;height:19px}
/* Keep the open file filled; hover another row with a lighter tint instead of clearing it.
   A selected directory only controls where new files land, so it must not read as a second open file. */
.dvw-tree-row:hover{background:color-mix(in srgb,var(--dvw-text) 4%,transparent)}
.dvw-tree-row[data-selected=true]{background:var(--dvw-active)}
.dvw-chevron{width:18px}
.dvw-file-icon{width:18px;height:18px}
.dvw-tree-rename,.dvw-tree-create-input{height:22px}
/* Branded empty state: a soft accent tile with the DSH whale. */
.dvw-empty>div{position:relative}
.dvw-empty>div::before{content:"";display:block;width:104px;height:104px;margin:0 auto 18px;background:${WORKBENCH_MARK} center/contain no-repeat}
/* Activity bar glyphs sized like VS Code's 24px icons in a 48px slot. */
.dvw-act::before{width:40px;height:40px;border-radius:8px}
/* Host styles set the codicon base size later in the cascade, so the rail needs the extra weight. */
.dvw-act .codicon,.dvw-activity-ghost .codicon{font-size:20px!important}
/* Inline SVGs otherwise sit on the text baseline and drift against the font glyphs. */
.dvw-act svg,.dvw-activity-ghost svg{display:block}
/* VS Code-like tab shape: rounded shoulders on the active tab blending into the editor, no separators between tabs. */
.dvw-tab{border-radius:10px 10px 0 0;border-right:0}
.dvw-tabs{background:color-mix(in srgb,var(--dvw-text) 4%,var(--dvw-base))}
.dvw-tab[data-active=true]{border-top:0;border-right-color:transparent}
.dvw-tab:hover:not([data-active=true]){background:color-mix(in srgb,var(--dvw-text) 3%,transparent)}
.dvw-tab[data-active=true]::before,.dvw-tab[data-active=true]::after{content:"";position:absolute;bottom:0;width:10px;height:10px;background:var(--dvw-surface-1);pointer-events:none}
.dvw-tab[data-active=true]::before{left:-10px;clip-path:path("M10 0C10 5.5 5.5 10 0 10L10 10Z")}
.dvw-tab[data-active=true]::after{right:-10px;clip-path:path("M0 0C0 5.5 4.5 10 10 10L0 10Z")}
.dvw-commit-box{position:relative;display:flex;align-items:stretch}
.dvw-commit-input{width:100%;min-height:30px;max-height:96px;field-sizing:content;resize:none;padding:5px 32px 5px 8px;line-height:18px}
.dvw-commit-ai{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:24px;min-width:24px;height:24px;padding:0;border:0;background:transparent;color:var(--dvw-text-3)}
.dvw-commit-ai:hover:not(:disabled){background:var(--dvw-hover);color:var(--dvw-text)}
.dvw-scm-panes,.dvw-scm-changes,.dvw-scm-panes>.dvw-graph{display:flex;flex-direction:column;min-height:0}
.dvw-scm-panes,.dvw-scm-panes>section[data-expanded=true]{flex:1 1 0}
.dvw-scm-panes>section[data-expanded=false]{flex:none}
.dvw-scm-panes>.dvw-graph{margin:0;padding:0;border-top:1px solid var(--dvw-border)}
.dvw-scm-panes[data-split=true]>.dvw-scm-changes{flex:0 0 var(--dvw-scm-changes-height,50%)}
.dvw-scm-panes[data-split=true]>.dvw-graph{border-top:0}
.dvw-scm-resizer{position:relative;z-index:6;flex:0 0 6px;margin-block:-3px;cursor:ns-resize;touch-action:none}
.dvw-scm-resizer::after{content:"";position:absolute;inset:2px 0 auto;height:1px;background:var(--dvw-border);pointer-events:none}
.dvw-scm-resizer:is(:hover,:focus-visible,[data-dragging=true])::after{height:2px;background:var(--dvw-accent)}
.dvw-scm-changes .dvw-git,.dvw-scm-panes .dvw-graph-list{min-height:0;overflow:auto;overscroll-behavior:contain}
.dvw-scm-panes .dvw-group-head{flex:none}
.dvw-scm-panes .dvw-group-head:is(:hover,:focus-within),
:is(.dvw-scm-head,.dvw-ssh-section-head):is(:hover,:focus-within){background:var(--dvw-hover)}
.dvw-scm-panes .dvw-group-toggle:hover,.dvw-ssh-section-head .dvw-group-toggle:hover{background:transparent}
.dvw-git .dvw-group-head{padding-left:4px}
.dvw-git .dvw-group-head>.dvw-group-toggle{padding-left:0;gap:3px}
.dvw-git .dvw-group-head>.dvw-icon{visibility:hidden}
.dvw-git .dvw-group-head:is(:hover,:focus-within)>.dvw-icon{visibility:visible}
.dvw-git .dvw-group-head .dvw-count{margin-left:3px;height:16px;min-width:16px;padding:0 4px;border-radius:9px;background:var(--dvw-accent);color:white}
:is(.dvw-scm-head,.dvw-ssh-section-head){display:flex;align-items:center;position:relative;min-height:28px;padding:0 4px;gap:1px;z-index:5}
:is(.dvw-scm-head,.dvw-ssh-section-head)>.dvw-group-toggle{padding:0;gap:3px;min-width:44px}
:is(.dvw-scm-head,.dvw-ssh-section-head) .dvw-icon{flex:0 1 22px;width:22px;min-width:17px;padding:0}
.dvw-scm-menu-anchor{position:relative;display:flex}
.dvw-scm-menu{position:fixed;inset:auto;margin:0;width:min(220px,calc(100vw - 8px));max-height:min(70vh,550px);overflow:auto;z-index:9;padding:4px;border:1px solid var(--dvw-border);border-radius:6px;background:var(--dvw-surface-2);box-shadow:0 5px 18px #0004}
.dvw-scm-menu button{display:flex;align-items:center;justify-content:space-between;width:100%;padding:4px 9px;min-height:25px;color:var(--dvw-text);background:transparent;text-align:left;border:0;border-radius:3px;font:inherit;cursor:pointer}
.dvw-scm-menu button:is(:hover,:focus-visible){background:var(--dvw-active)}
.dvw-scm-menu button:disabled{opacity:.5}
.dvw-scm-menu button[data-divider=true]{margin-top:4px;border-top:1px solid var(--dvw-border)}
.dvw-scm-status{position:relative;display:flex;align-items:center;gap:4px}
.dvw-scm-status .dvw-branch{font-weight:400;height:22px;white-space:nowrap}
.dvw-scm-status button:hover{background:var(--dvw-hover)}
.dvw-scm-status .dvw-branch-menu{bottom:calc(100% + 3px);top:auto;left:0;right:auto;width:min(310px,85vw);z-index:30}
.dvw-change-path{display:flex;gap:5px;align-items:baseline}
.dvw-change-path small{overflow:hidden;text-overflow:ellipsis;color:var(--dvw-text-3)}
.dvw-change:not(:hover):not(:focus-within) .dvw-icon{display:none}
.dvw-change-folder{padding-left:10px}
.dvw-change-folder summary{cursor:pointer;line-height:22px}
.dvw-commit-ai[aria-busy=true]{background:var(--dvw-hover);color:var(--dvw-text)}
.dvw-scm-stop{display:grid;place-items:center;width:16px;height:16px;border:1px solid currentColor;border-radius:50%}
.dvw-scm-stop::after{content:"";width:6px;height:6px;border-radius:1px;background:currentColor}
.dvw-scm-dialog,.dvw-commit-hover{color:var(--dvw-text);background:var(--dvw-surface-2);border:1px solid color-mix(in srgb,var(--dvw-border) 82%,transparent);border-radius:12px;box-shadow:0 16px 40px #0005,0 2px 8px #0003}
.dvw-scm-dialog{width:min(540px,90vw)}
.dvw-scm-dialog form label{display:grid;gap:4px;margin:8px 0}
.dvw-scm-dialog textarea{width:100%;min-height:160px}
.dvw-scm-dialog pre{white-space:pre-wrap;max-height:60vh;overflow:auto}
.dvw-commit-hover{position:fixed;inset:auto;margin:0;padding:14px 16px;z-index:50;box-sizing:border-box;width:max-content;max-width:min(430px,calc(100vw - 8px));max-height:85vh;overflow:auto;font:inherit;text-align:left;overflow-wrap:anywhere}
.dvw-commit-hover time{color:var(--dvw-text-2)}
.dvw-commit-hover p{margin:7px 0;white-space:pre-wrap}
.dvw-hover-refs,.dvw-hover-actions,.dvw-commit-stats{border-top:1px solid var(--dvw-border-soft);padding-top:6px;margin-top:6px}
.dvw-hover-refs,.dvw-hover-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.dvw-hover-refs .dvw-ref{max-width:100%;height:auto;white-space:normal;overflow-wrap:anywhere}
.dvw-hover-actions button,.dvw-hover-actions a{display:inline-flex;align-items:center;gap:5px;min-height:28px;padding:0 6px;border-radius:6px;color:var(--dvw-accent);border:0;background:transparent;cursor:pointer;font:inherit;text-decoration:none}
.dvw-hover-actions button:hover,.dvw-hover-actions a:hover{background:var(--dvw-hover)}
.dvw-commit-stats span:first-child{color:var(--dvw-success)}
.dvw-commit-stats span:last-child{color:var(--dvw-error)}
/* VS Code-style split commit button: primary action plus a narrow dropdown for commit variants. */
.dvw-commit .dvw-commit-actions{display:flex;gap:0;position:relative}
.dvw-commit .dvw-commit-button{flex:1;min-width:0;height:30px;border:0;border-radius:6px 0 0 6px;background:var(--dvw-accent);color:#fff;display:flex;align-items:center;justify-content:center;gap:7px;font:inherit;cursor:pointer}
.dvw-commit .dvw-commit-button:hover:not(:disabled){background:color-mix(in srgb,var(--dvw-accent) 88%,#fff)}
.dvw-commit .dvw-commit-button:disabled{opacity:.45;cursor:default}
.dvw-commit .dvw-commit-more{flex:none;width:30px;height:30px;border:0;border-left:1px solid rgba(255,255,255,.3);border-radius:0 6px 6px 0;background:var(--dvw-accent);color:#fff;display:grid;place-items:center;cursor:pointer}
.dvw-commit .dvw-commit-more:hover:not(:disabled){background:color-mix(in srgb,var(--dvw-accent) 88%,#fff)}
.dvw-commit .dvw-commit-more:disabled{opacity:.45;cursor:default}
.dvw-commit .dvw-commit-menu{position:absolute;z-index:12;top:calc(100% + 4px);right:0;min-width:180px;padding:4px;border:1px solid var(--dvw-border);border-radius:8px;background:var(--dvw-surface-2);box-shadow:0 10px 28px rgba(0,0,0,.28)}
.dvw-commit .dvw-commit-menu button{width:100%;height:26px;border:0;border-radius:4px;background:transparent;color:var(--dvw-text);padding:0 8px;text-align:left;font:inherit;cursor:pointer}
.dvw-commit .dvw-commit-menu button:hover{background:var(--dvw-hover)}
/* Eye-care theme: a warm paper-yellow surface shared by every panel and the editor. */
.dvw-overlay[data-dvw-theme=eyecare]{--dvw-base:#f7ebc8;--dvw-surface-1:#f7ebc8;--dvw-surface-2:#f7ebc8;--dvw-surface-3:#f7ebc8;--dvw-side:#f7ebc8;--dvw-tab-active:#ecdcae;--dvw-gutter:#f7ebc8;--dvw-graph-ref:#9c6b1e;--dvw-text:#3b3324;--dvw-text-2:#6b604a;--dvw-text-3:#92856a;--dvw-border:#e0cf9f;--dvw-border-soft:#eadcb6;--dvw-hover:#0000000c;--dvw-active:#00000014;--dvw-accent:#9c6b1e;--dvw-error:#b03a2e;--dvw-success:#4c7a34;--dvw-warn:#8a5a00;color-scheme:light}
.dvw-overlay[data-dvw-theme=eyecare] .dvw-tabs{background:#f7ebc8}
.dvw-overlay[data-dvw-theme=eyecare] .dvw-act[data-active=true]::before{background:#00000016}
.dvw-theme-swatch.eyecare{background:#f7ebc8}
body[data-dvw-palette=eyecare] [data-dvw-conversation-panel]{--dsw-alias-bg-base:#f7ebc8;--dsw-specific-sidebar-fill:#f7ebc8;--dsw-alias-bg-layer-1:#f7ebc8;--dsw-alias-bg-layer-2:#f1e2b8;--dsw-alias-bg-layer-3:#ecdcae;--dsw-alias-bg-layer-4:#ecdcae;--dsw-specific-input-major:#f7ebc8;--dsw-specific-login-input:#f1e2b8;--dsw-menu-surface-fill:#f7ebc8;--dsw-alias-label-primary:#3b3324;--dsw-alias-label-secondary:#6b604a;--dsw-alias-label-tertiary:#92856a;--dsw-alias-border-l2:#e0cf9f;--dsw-alias-border-l3:#eadcb6;--dsw-alias-interactive-bg-hover:#0000000c;--dsw-alias-interactive-bg-active:#00000014;background:#f7ebc8!important}
/* Settings dialog: left navigation rail with aligned label/control rows, mirroring DSH settings. */
/* Settings page inside DSH's own dialog: single column, group headings, host tokens for every color. */
.dvw-set-page{display:flex;flex-direction:column;padding:0 0 20px}
.dvw-set-group{display:flex;flex-direction:column}
.dvw-set-group-title{margin:18px 8px 4px;font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c)}
.dvw-set-row{display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,#e5e5e5)}
.dvw-set-row:last-child{border-bottom:0}
.dvw-set-text{flex:1;min-width:0;padding-right:48px;display:flex;flex-direction:column;gap:4px}
.dvw-set-title{color:var(--dsw-alias-label-primary,#0f1115);font-size:14px;font-weight:400;line-height:22px}
.dvw-set-desc{color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;font-weight:400;line-height:18px}
.dvw-set-control{flex:none;display:flex;align-items:center;gap:8px}
.dvw-set-switch{box-sizing:border-box;position:relative;flex:none;width:36px;height:20px;border:0;border-radius:999px;corner-shape:round;padding:2px;cursor:pointer;background:var(--dsw-alias-border-l3,#e5e5e5);transition:background .12s}
.dvw-set-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary,#0f1115)}
.dvw-set-knob{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground,#fff);transition:transform .12s ease}
.dvw-set-switch[aria-checked=true] .dvw-set-knob{transform:translateX(16px)}
.dvw-set-switch[aria-checked=false] .dvw-set-knob{background:var(--dsw-alias-switch-thumb,#fff)}
.dvw-set-selector{max-width:min(420px,40vw);border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-module-platform,#f5f6f7);height:36px;font:inherit;color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;border:none;display:inline-flex;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;white-space:nowrap}
.dvw-set-selector-text{min-width:0;display:flex;align-items:center;gap:8px;overflow:hidden;text-overflow:ellipsis}
.dvw-set-selector:hover{background:var(--dsw-alias-interactive-bg-hover,#eceef0)}
.dvw-set-chevron{flex:none;width:14px;height:14px}
.dvw-set-menu{box-sizing:border-box;position:fixed;z-index:220;max-width:calc(100vw - 16px);overflow-y:auto;padding:6px;border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);box-shadow:0 8px 28px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:2px}
.dvw-set-menu button{display:flex;flex:none;align-items:center;justify-content:space-between;gap:16px;min-width:0;height:32px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:14px;cursor:pointer;text-align:left;white-space:nowrap}
.dvw-set-option-label{min-width:0;display:flex;align-items:center;gap:8px;overflow:hidden}
.dvw-set-option-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dvw-set-model-badge{flex:none;padding:0 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cff) 14%,transparent);color:var(--dsw-alias-brand-primary,#3768e8);font-size:11px;font-weight:500;line-height:20px;font-variant-numeric:tabular-nums}
.dvw-set-model-badge[data-tone=neutral]{background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#81858c) 14%,transparent);color:var(--dsw-alias-label-secondary,#6b7280)}
.dvw-set-model-badge[data-tone=success]{background:color-mix(in srgb,var(--dvw-success,#218c4a) 14%,transparent);color:var(--dvw-success,#218c4a)}
.dvw-set-model-badge[data-tone=warning]{background:color-mix(in srgb,var(--dvw-warn,#b7791f) 14%,transparent);color:var(--dvw-warn,#b7791f)}
.dvw-set-menu button:hover{background:var(--dsw-alias-interactive-bg-hover,#eceef0)}
.dvw-set-menu button[data-active=true]{font-weight:500}
.dvw-set-check{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dvw-set-range{display:inline-flex;align-items:center;gap:12px}
.dvw-set-range input{appearance:none;-webkit-appearance:none;width:150px;height:20px;margin:0;background:transparent;cursor:pointer}
.dvw-set-range input::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(to right,var(--dsw-alias-brand-primary,#0f1115) 0 var(--dvw-set-range-fill,50%),var(--dsw-alias-border-l3,#e5e5e5) var(--dvw-set-range-fill,50%) 100%)}
.dvw-set-range input::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;border:0;border-radius:50%;background:var(--dsw-alias-brand-primary,#0f1115)}
.dvw-set-range input:focus-visible{outline:none}
.dvw-set-range output{min-width:42px;text-align:right;color:var(--dsw-alias-label-tertiary,#81858c);font-size:14px;font-variant-numeric:tabular-nums}
.dvw-set-button{height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:14px;line-height:22px;cursor:pointer;white-space:nowrap}
.dvw-set-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#eceef0)}
.dvw-set-button:disabled{opacity:.45;cursor:default}
.dvw-set-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.dvw-set-chip{padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-module-platform,#f5f6f7);font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c)}
.dvw-set-chip[data-installed=true]{color:var(--dsw-alias-state-success-primary,#3fa266)}
.dvw-set-chip[data-action=true]{color:var(--dsw-alias-state-warn-primary,#b8860b)}
.dvw-set-hint{margin-left:2px;font-size:12px;color:var(--dsw-alias-label-tertiary,#81858c)}
.dvw-set-footnote{margin:10px 8px 0;color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;line-height:1.6}
.dvw-set-error{color:var(--dsw-alias-state-error-primary,#f48771)}
@media(max-width:720px){.dvw-set-row{flex-direction:column;align-items:stretch;gap:8px}.dvw-set-text{padding-right:0}.dvw-set-control{justify-content:flex-start}}
/* Monaco owns diff scrolling; an outer scroller changes the width as scrollbars appear and makes split mode oscillate. */
.dvw-editor{min-width:0;overflow:hidden}
.dvw-pane>.dvw-editor{flex:1;min-height:0}
.dvw-panes{display:flex;flex:1;min-width:0;min-height:0}
.dvw-split{display:flex;flex:1;min-width:0;min-height:0}
.dvw-split[data-direction=column]{flex-direction:column}
.dvw-slot{display:flex;flex-basis:0;min-width:0;min-height:0}
.dvw-splitter{flex:0 0 4px;background:var(--dvw-border-soft);cursor:col-resize;position:relative;z-index:2}
.dvw-splitter[data-direction=column]{cursor:row-resize}
.dvw-splitter:hover,.dvw-splitter:active{background:var(--dvw-accent)}
.dvw-pane{position:relative;display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;outline:1px solid transparent;outline-offset:-1px}
.dvw-pane[data-focused]{outline-color:var(--dvw-border-soft)}.dvw-pane[data-tab-target]{outline-color:var(--dvw-accent)}
.dvw-pane-drop{position:fixed;inset:auto;z-index:2147483647;margin:0;padding:0;max-width:none;max-height:none;box-sizing:border-box;pointer-events:none;background:color-mix(in srgb,var(--dvw-accent) 20%,transparent);border:1px solid var(--dvw-accent)}
.dvw-pane-drop::backdrop{background:transparent;pointer-events:none}
.dvw-editor-body{min-width:0;overflow:hidden}
.dvw-monaco-diff{height:auto;min-width:0;min-height:0;margin:0;padding:0;overflow:hidden;white-space:normal}
/* Keep the workspace switcher in the same elevated surface family as workbench settings. */
.dvw-workspace-layer{position:fixed!important;inset:0!important;z-index:1000!important;display:block!important;padding:0!important;background:transparent!important;overflow:hidden!important}
.dvw-workspace-backdrop{position:absolute;inset:0;z-index:50;display:grid;place-items:center;padding:24px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));backdrop-filter:none}
.dvw-workspace-switcher{width:min(640px,calc(100vw - 48px));height:min(680px,calc(100vh - 48px));max-height:none;border-radius:18px;overflow:hidden;box-shadow:0 16px 50px rgba(0,0,0,.32)}
.dvw-workspace-switcher>header{height:52px;padding:0 12px 0 20px;font-size:15px}
.dvw-workspace-list{padding:10px}
.dvw-workspace-row{border-radius:11px}
.dvw-workspace-toggle{height:40px;padding:0 12px}
.dvw-workspace-sessions{gap:3px;padding:4px 0 8px 32px}
.dvw-workspace-session{height:34px;padding:0 12px;border-radius:11px}
.dvw-workspace-switcher>footer{padding:12px 16px}
.dvw-workspace-switcher>footer button{height:32px;border-radius:9px;padding:0 16px}
.dvw-workspace-switcher>footer button.dvw-primary-button:hover:not(:disabled){background:color-mix(in srgb,var(--dvw-accent) 86%,#000)}
.dvw-workspace-switcher>footer .dvw-workspace-new-session{margin-right:auto;display:inline-flex;align-items:center;gap:6px}
.dvw-workspace-switcher>footer .dvw-workspace-new-session .codicon{font-size:14px}
.dvw-workspace-switcher .dvw-icon{border-radius:9px}
.dvw-dsh-tab-mark{width:16px;height:16px;flex:none;background:currentColor;-webkit-mask:${DSH_MARK_MASK} center/contain no-repeat;mask:${DSH_MARK_MASK} center/contain no-repeat}
.codicon-globe:before{content:"\eb01"}
.dvw-terminal-pane{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column}.dvw-terminal-panes[data-split=true]>.dvw-terminal-pane+.dvw-terminal-pane{border-left:1px solid var(--dvw-border)}
.dvw-terminal-notice{display:flex;align-items:center;gap:8px;padding:4px 10px;color:var(--dvw-text-2);font-size:12px}.dvw-terminal-notice button,.dvw-start-tools button{border:1px solid var(--dvw-border);border-radius:4px;background:var(--dvw-surface-2);color:var(--dvw-text);font:inherit;cursor:pointer}.dvw-terminal-notice button:hover,.dvw-start-tools button:hover{background:var(--dvw-hover)}
.dvw-start-tools{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:20px;padding:0 12px}.dvw-start-tools button{display:flex;align-items:center;gap:8px;padding:8px 16px}.dvw-start-tools button:disabled{opacity:.45;cursor:default}
[data-dvw-dsh-page]{position:fixed!important;z-index:106!important;margin:0!important;display:flex!important;flex-direction:column!important;box-sizing:border-box!important;overflow:hidden!important;background:var(--dsw-alias-bg-base,#fff)!important;border:0!important;border-radius:0!important;box-shadow:none!important;--dsh-frame-top-clearance:0px;--dsh-frame-chrome-top:0px}
[data-dvw-dsh-page][data-dvw-dsh-hidden]{display:none!important}
.dvw-tab-review{min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:color-mix(in srgb,var(--dvw-success) 22%,var(--dvw-surface-2));color:var(--dvw-success);font-size:10px;font-weight:600;line-height:16px;text-align:center;flex:none}.dvw-tab-review[data-conflict]{background:color-mix(in srgb,var(--dvw-error) 18%,var(--dvw-surface-2));color:var(--dvw-error)}.dvw-tab[data-review-conflict=true] .dvw-tab-icon{color:var(--dvw-error)}
.dvw-review-line-added{background:color-mix(in srgb,var(--dvw-success) 20%,transparent)}.dvw-review-line-conflict{background:color-mix(in srgb,var(--dvw-error) 14%,transparent)}.dvw-review-gutter-added{border-left:2px solid var(--dvw-success)}.dvw-review-gutter-conflict{border-left:2px solid var(--dvw-error)}.dvw-review-zone{margin:0;background:color-mix(in srgb,var(--dvw-error) 18%,var(--dvw-surface-1));color:color-mix(in srgb,var(--dvw-error) 82%,var(--dvw-text));overflow:hidden}.dvw-review-zone[data-conflict]{background:color-mix(in srgb,var(--dvw-error) 14%,var(--dvw-surface-1));color:var(--dvw-text)}.dvw-review-removed{margin:0;padding:0 10px;color:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:inherit;line-height:inherit;white-space:pre;overflow:hidden}.dvw-review-widget{position:relative;z-index:4;display:flex;align-items:center;width:max-content;max-width:calc(100% - 54px);margin:3px 0 3px 50px;border:1px solid color-mix(in srgb,var(--dvw-success) 45%,var(--dvw-border));border-radius:9px;background:color-mix(in srgb,var(--dvw-success) 12%,var(--dvw-surface-1));box-shadow:0 3px 12px rgba(0,0,0,.16);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);font-size:11px}.dvw-review-zone-actions{min-height:29px;display:flex;align-items:center;justify-content:flex-end;gap:4px;padding:3px;flex-wrap:wrap}.dvw-review-zone-label{min-width:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dvw-error)}.dvw-review-zone-label:empty{display:none}.dvw-review-zone-actions button{height:23px;display:inline-flex;align-items:center;gap:4px;padding:0 9px;border:1px solid color-mix(in srgb,var(--dvw-border) 82%,transparent);border-radius:999px;background:color-mix(in srgb,var(--dvw-surface-1) 88%,transparent);color:var(--dvw-text-2);font:inherit;font-size:10px;font-weight:550;cursor:pointer;white-space:nowrap}.dvw-review-zone-actions button[data-action=accept]{border-color:color-mix(in srgb,var(--dvw-success) 48%,var(--dvw-border));color:var(--dvw-success)}.dvw-review-zone-actions button[data-action=reject]{border-color:color-mix(in srgb,var(--dvw-error) 42%,var(--dvw-border));color:var(--dvw-error)}.dvw-review-zone-actions button[data-action=ask]{border-color:color-mix(in srgb,var(--dvw-accent) 46%,var(--dvw-border));color:var(--dvw-accent)}.dvw-review-zone-actions button:hover:not(:disabled){background:var(--dvw-hover);color:var(--dvw-text)}.dvw-review-zone-actions button:disabled{opacity:.45;cursor:default}
.dvw-review-composer-host{--dvw-surface-1:var(--dsw-alias-bg-layer-1,#fff);--dvw-surface-2:var(--dsw-alias-bg-layer-2,#f5f5f5);--dvw-text:var(--dsw-alias-label-primary,#171717);--dvw-text-2:var(--dsw-alias-label-secondary,#5c5c5c);--dvw-text-3:var(--dsw-alias-label-tertiary,#8c8c8c);--dvw-border:var(--dsw-alias-border-l2,#dedede);--dvw-hover:var(--dsw-alias-interactive-bg-hover,#0000000c);--dvw-accent:var(--dsw-alias-state-business-primary,#3b82f6);--dvw-warn:var(--dsw-alias-state-warn-primary,#c69026);--dvw-error:var(--dsw-alias-state-error-primary,#d13438);--dvw-success:var(--dsw-alias-state-success-primary,#2e7d32);flex:none;min-width:0}
.dvw-review-composer{margin:0 10px 8px;border:1px solid color-mix(in srgb,var(--dvw-border) 82%,transparent);border-radius:11px;background:var(--dvw-surface-1);color:var(--dvw-text);box-shadow:0 8px 24px rgba(15,23,42,.08),0 1px 2px rgba(15,23,42,.05);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);font-size:12px;overflow:hidden}
.dvw-review-composer-summary{min-height:48px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;padding:7px 8px 7px 11px;border-bottom:1px solid color-mix(in srgb,var(--dvw-border) 72%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--dvw-surface-2) 36%,var(--dvw-surface-1)),var(--dvw-surface-1))}
.dvw-review-composer-status{width:26px;height:26px;display:grid;place-items:center;border-radius:8px;background:color-mix(in srgb,var(--dvw-warn) 12%,var(--dvw-surface-1));color:var(--dvw-warn)}
.dvw-review-composer-status::before{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 15%,transparent);content:""}
.dvw-review-composer-heading{min-width:0;display:flex;flex-direction:column;gap:2px;line-height:1.25}
.dvw-review-composer-heading strong{overflow:hidden;color:var(--dvw-text);font-size:13px;font-weight:650;letter-spacing:-.01em;text-overflow:ellipsis;white-space:nowrap}
.dvw-review-composer-heading span{overflow:hidden;color:var(--dvw-text-2);font-size:11px;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
.dvw-review-composer-actions{display:flex;align-items:center;gap:6px}
.dvw-review-composer-actions button{height:28px;padding:0 9px;border:1px solid color-mix(in srgb,var(--dvw-error) 26%,var(--dvw-border));border-radius:7px;background:color-mix(in srgb,var(--dvw-error) 5%,transparent);color:var(--dvw-error);font:inherit;font-weight:550;cursor:pointer;white-space:nowrap;transition:background-color 120ms ease,border-color 120ms ease,color 120ms ease}
.dvw-review-composer-actions button[data-action=accept]{border-color:color-mix(in srgb,var(--dvw-success) 58%,var(--dvw-border));background:color-mix(in srgb,var(--dvw-success) 10%,var(--dvw-surface-1));color:var(--dvw-success)}
.dvw-review-composer-actions button:hover:not(:disabled){border-color:color-mix(in srgb,var(--dvw-error) 54%,var(--dvw-border));background:color-mix(in srgb,var(--dvw-error) 12%,var(--dvw-surface-1))}
.dvw-review-composer-actions button[data-action=accept]:hover:not(:disabled){border-color:var(--dvw-success);background:color-mix(in srgb,var(--dvw-success) 18%,var(--dvw-surface-1));color:var(--dvw-success)}
.dvw-review-composer-actions button:active:not(:disabled){transform:translateY(1px)}
.dvw-review-composer-actions button:disabled{opacity:.42;cursor:default}
.dvw-review-composer :is(button):focus-visible{outline:2px solid color-mix(in srgb,var(--dvw-accent) 72%,transparent);outline-offset:2px}
.dvw-review-composer-file-strip{position:relative;min-width:0}
.dvw-review-composer-files{display:flex;gap:5px;overflow-x:auto;overscroll-behavior-inline:contain;padding:7px 11px 8px;scroll-snap-type:x proximity;scrollbar-width:none;-webkit-mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 22px),transparent 100%);mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 22px),transparent 100%)}
.dvw-review-composer-file-strip[data-scroll-left] .dvw-review-composer-files{padding-left:38px}
.dvw-review-composer-file-strip[data-scroll-right] .dvw-review-composer-files{padding-right:38px}
.dvw-review-composer-files::-webkit-scrollbar{display:none}
.dvw-review-composer-files button{flex:none;display:flex;align-items:center;gap:7px;max-width:220px;height:29px;padding:0 5px 0 9px;border:1px solid color-mix(in srgb,var(--dvw-border) 72%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dvw-surface-2) 58%,var(--dvw-surface-1));color:var(--dvw-text-2);font:inherit;cursor:pointer;scroll-snap-align:start;transition:background-color 120ms ease,border-color 120ms ease,color 120ms ease}
.dvw-review-composer-files button:hover{border-color:color-mix(in srgb,var(--dvw-accent) 34%,var(--dvw-border));background:color-mix(in srgb,var(--dvw-accent) 8%,var(--dvw-surface-2));color:var(--dvw-text)}
.dvw-review-composer-files button:active{background:color-mix(in srgb,var(--dvw-accent) 13%,var(--dvw-surface-2))}
.dvw-review-composer-files span{min-width:0;overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.dvw-review-composer-files b{min-width:19px;height:19px;display:grid;place-items:center;padding:0 4px;border-radius:6px;background:color-mix(in srgb,var(--dvw-accent) 11%,transparent);color:var(--dvw-accent);font-size:10px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1}
.dvw-review-composer-files:focus-visible{outline:2px solid color-mix(in srgb,var(--dvw-accent) 72%,transparent);outline-offset:-2px}
.dvw-review-composer-scroll{position:absolute;z-index:2;top:50%;width:25px;height:29px;display:grid;place-items:center;padding:0;border:1px solid color-mix(in srgb,var(--dvw-border) 78%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dvw-surface-1) 92%,transparent);color:var(--dvw-text-2);box-shadow:0 2px 8px rgba(15,23,42,.12);font:600 18px/1 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);cursor:pointer;transform:translateY(-50%)}
.dvw-review-composer-scroll[data-direction=previous]{left:7px}
.dvw-review-composer-scroll[data-direction=next]{right:7px}
.dvw-review-composer-scroll:hover{border-color:color-mix(in srgb,var(--dvw-accent) 42%,var(--dvw-border));background:var(--dvw-surface-2);color:var(--dvw-text)}
@media(max-width:520px){.dvw-review-composer{margin-inline:7px}.dvw-review-composer-summary{gap:7px;padding-inline:9px 7px}.dvw-review-composer-status{width:24px;height:24px}.dvw-review-composer-actions button{height:27px;padding-inline:8px}.dvw-review-composer-heading strong{font-size:12px}}
@media(prefers-reduced-motion:reduce){.dvw-review-composer :is(button){transition:none}.dvw-review-composer-actions button:active:not(:disabled){transform:none}}
.dvw-editor .lines-content>.view-zones{z-index:2}
/* The DSH host paints a -webkit-app-region:drag strip over the window's top-left corner. Real mouse presses
   inside it never reach the renderer, so the workbench has to carve the whole overlay out of it. */
.dvw-review-removed{padding:0}
html:not([data-windows-titlebar]) .dvw-overlay,.dvw-overlay[data-dvw-float=true]{-webkit-app-region:no-drag}
/* The Windows host owns this caption strip. Anchor it to the viewport while the panes scroll. */
html[data-windows-titlebar]:not([data-fullscreen]) body[data-dvw-workbench-active] :has(> [data-shell-overlay])::before{position:fixed}
/* Floating layout: the workbench stays inside the same native window but paints as a movable layer over DSH.
   Geometry and the top inset come from Workbench.tsx as inline styles; these rules only shape the shell. */
.dvw-overlay[data-dvw-float=true]{position:fixed;inset:auto;z-index:100;padding-top:34px;border:1px solid var(--dvw-border);border-radius:10px;box-shadow:0 18px 48px rgba(0,0,0,.45)}
[data-dvw-floating-surface]{right:auto!important;bottom:auto!important;z-index:106!important;margin:0!important;max-width:none!important;max-height:none!important;box-sizing:border-box!important;-webkit-app-region:no-drag}
[data-dvw-floating-surface]::backdrop{background:transparent;pointer-events:none}
.dvw-overlay[data-dvw-float=true] .dvw-chat-resizer{position:absolute;top:0;bottom:0;left:-6px;right:auto}
.dvw-overlay[data-dvw-float=true] .dvw-chat-body{height:100%;margin:0 3px}
.dvw-overlay[data-dvw-float=true] .dvw-titlebar{display:none}
.dvw-overlay[data-dvw-float-max=true]{border-radius:0;border-width:0 0 1px;box-shadow:none}
/* The document goes fullscreen so DSH-owned pages and the overlay share a root. */
.dvw-overlay[data-dvw-float-fullscreen=true]{position:fixed!important;inset:0!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;padding-top:34px!important;border:0!important;border-radius:0!important;box-shadow:none!important}
.dvw-overlay[data-dvw-float-fullscreen=true] .dvw-float-handle{display:none}
.dvw-floatbar{position:absolute;z-index:7;top:0;right:0;left:0;height:34px;display:flex;align-items:center;gap:8px;padding:0 6px 0 10px;border-bottom:1px solid var(--dvw-border);background:var(--dvw-base);color:var(--dvw-text-2);cursor:grab;user-select:none;touch-action:none}
.dvw-floatbar:active{cursor:grabbing}
.dvw-floatbar-mark{flex:none;display:flex;color:var(--dvw-text-2)}
.dvw-floatbar strong{flex:none;font-size:12px;font-weight:600;color:var(--dvw-text-2)}
.dvw-floatbar-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dvw-text-3);font-size:11px}
.dvw-floatbar-actions{flex:none;display:flex;gap:2px;margin-left:auto}
.dvw-float-handle{position:absolute;z-index:6;touch-action:none}
.dvw-float-handle[data-handle=n]{top:34px;right:14px;left:14px;height:6px;cursor:ns-resize}
.dvw-float-handle[data-handle=s]{right:14px;bottom:0;left:14px;height:6px;cursor:ns-resize}
.dvw-float-handle[data-handle=w]{top:34px;bottom:14px;left:0;width:8px;cursor:ew-resize}
.dvw-float-handle[data-handle=e]{top:34px;right:0;bottom:14px;width:8px;cursor:ew-resize}
.dvw-float-handle[data-handle=nw]{top:34px;left:0;width:12px;height:12px;cursor:nwse-resize}
.dvw-float-handle[data-handle=ne]{top:34px;right:0;width:12px;height:12px;cursor:nesw-resize}
.dvw-float-handle[data-handle=sw]{bottom:0;left:0;width:12px;height:12px;cursor:nesw-resize}
.dvw-float-handle[data-handle=se]{right:0;bottom:0;width:12px;height:12px;cursor:nwse-resize}
.dvw-unsupported{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:var(--dvw-surface-1)}
.dvw-unsupported-icon{font-size:44px!important;line-height:1;color:color-mix(in srgb,var(--dvw-text) 38%,transparent)}
.dvw-unsupported-label{font-size:14px;color:var(--dvw-text-2);max-width:80%;text-align:center;word-break:break-all}
.dvw-editor-body:has(.dvw-unsupported)>.dvw-message{display:none}
.dvw-open-with{display:inline-flex;flex-direction:column;align-items:center;gap:10px}
.dvw-open-with-buttons{display:inline-flex;align-items:stretch;min-width:132px;border:1px solid var(--dvw-border);border-radius:10px;background:transparent;overflow:hidden}
.dvw-open-with-main,.dvw-open-with-more{border:0;background:transparent;color:var(--dvw-text);font:inherit;font-size:14px;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer}
.dvw-open-with-main{height:40px;padding:0 18px;flex:1}
.dvw-open-with-more{width:40px;height:40px;padding:0;border-left:1px solid var(--dvw-border)}
.dvw-open-with-main .codicon,.dvw-open-with-more .codicon{font-size:16px}
.dvw-open-with-main:hover:not(:disabled),.dvw-open-with-more:hover:not(:disabled){background:var(--dvw-hover)}
.dvw-open-with-main:disabled,.dvw-open-with-more:disabled{opacity:.6;cursor:default}
.dvw-open-with-main img,.dvw-open-with-menu img{object-fit:contain;flex:none}
.dvw-open-with[data-size=compact] .dvw-open-with-buttons{box-sizing:border-box;min-width:0;height:24px;border:.5px solid var(--dsw-alias-border-l4,var(--dvw-border));border-radius:var(--dsw-radius-sm,6px)}
.dvw-open-with[data-size=compact] .dvw-open-with-main{flex:none;height:auto;padding:3px 5px;gap:4px;font-size:11px;line-height:16px}
.dvw-open-with[data-size=compact] .dvw-open-with-more{width:auto;height:auto;padding:3px 4px 3px 3px;border-left:.5px solid var(--dsw-alias-border-l4,var(--dvw-border));color:var(--dvw-text-2)}
.dvw-open-with[data-size=compact] .dvw-open-with-main .codicon{font-size:13px}.dvw-open-with[data-size=compact] .dvw-open-with-more .codicon{font-size:10px}
.dvw-open-with[data-size=compact] button:disabled{opacity:1}.dvw-open-with button:focus-visible{outline:1px solid var(--dvw-accent);outline-offset:-2px;background:var(--dvw-hover)}
.dvw-open-with-skeleton{display:inline-block;flex:none;width:18px;height:18px;border-radius:var(--dsw-radius-xs,3px);background:var(--dvw-hover)}.dvw-open-with[data-size=compact] .dvw-open-with-skeleton{width:13px;height:13px}
.dvw-open-with{position:relative}
.dvw-open-with-menu{position:fixed!important;bottom:auto!important;right:auto!important;transform:none;z-index:150;display:flex;flex-direction:column;min-width:min(208px,calc(100vw - 16px));width:max-content;max-width:min(520px,calc(100vw - 16px));padding:4px;border-radius:var(--dsw-radius-md,10px);background:var(--dvw-surface-1);color:var(--dvw-text);overflow:hidden}
.dvw-open-with-menu .dvw-open-with-applications{display:flex;flex-direction:column;min-height:0;overflow:auto}.dvw-open-with-menu>.dvw-menu-separator{flex:none}
.dvw-open-with-menu button{flex:none;display:flex;align-items:center;gap:8px;min-height:30px;height:auto;padding:5px 8px;font-size:13px;line-height:20px;border-radius:var(--dsw-radius-xs,4px);text-align:left;overflow-wrap:anywhere;white-space:normal}.dvw-open-with-menu button .codicon{font-size:14px;flex:none}.dvw-open-with-menu button:focus-visible{outline:1px solid var(--dvw-accent);outline-offset:-1px;background:var(--dvw-hover)}
.dvw-open-with-note{font-size:12px;color:var(--dvw-text-3)}
.dvw-open-with-error{color:var(--dvw-warn)}
.dvw-search{display:flex;min-height:0;flex:1;flex-direction:column}
.dvw-search[hidden]{display:none}
.dvw-search-head{flex:none;justify-content:space-between;padding:0 8px 0 13px}
.dvw-search-head>div,.dvw-replace-row{display:flex;align-items:center;gap:4px}
.dvw-search .dvw-icon{flex:none;width:22px;min-width:0;height:22px;padding:0;color:var(--dvw-text)}
.dvw-search .dvw-icon:disabled{opacity:.38;cursor:default}
.dvw-search .dvw-icon:hover:enabled{background:var(--dvw-hover)}
.dvw-search .dvw-icon[aria-pressed=true]{background:color-mix(in srgb,var(--dvw-accent) 25%,transparent);box-shadow:inset 0 0 0 1px var(--dvw-accent)}
.dvw-search button:focus-visible{outline:1px solid var(--dvw-accent);outline-offset:-1px}
.dvw-search-form{margin:0 10px 0 2px;padding:4px 0 6px}
.dvw-search-form fieldset{border:0;margin:0;padding:0;min-width:0}
.dvw-search-widget{position:relative;padding-left:18px;display:grid;gap:6px}
.dvw-search .dvw-search-disclosure{position:absolute;top:0;left:0;width:16px;height:100%}
.dvw-search-box{display:flex;align-items:center;flex:1;min-width:0;height:26px;gap:1px;padding-right:2px;border:1px solid var(--dvw-border);border-radius:4px;background:var(--dvw-surface-2)}
.dvw-search-box:focus-within{border-color:var(--dvw-accent)}
.dvw-search-box input{width:0;min-width:0;flex:1;height:100%;border:0;background:transparent;color:var(--dvw-text);padding:0 0 0 6px;font:inherit;font-size:13px;outline:0}
.dvw-search-box input:focus-visible{outline:0}
.dvw-overlay[data-dvw-theme=dark] .dvw-search-box{background:var(--dvw-side)}
.dvw-search-box input::placeholder{color:var(--dvw-text-2)}
.dvw-search-box .dvw-icon{width:21px;height:21px;border-radius:3px}
.dvw-query-details{position:relative;margin-left:18px;min-height:17px}
.dvw-search .dvw-search-more{position:absolute;right:-2px;top:0;width:25px;height:16px}
.dvw-query-details label{display:block;padding-top:4px;font-size:11px;color:var(--dvw-text-2)}
.dvw-query-details .dvw-input{display:block;height:25px;margin-top:3px;font:inherit;font-size:13px}
.dvw-search-status{flex:none;padding:3px 10px 6px 20px;color:var(--dvw-text-2);font-size:12px;white-space:pre-line;overflow-wrap:anywhere;max-height:25%;overflow:auto}
.dvw-search-status:empty{display:none}
.dvw-search .dvw-results{min-height:0;overflow:auto}
.dvw-search-result-row{height:22px;display:flex;align-items:center;padding-right:6px}
.dvw-search-result-row:hover,.dvw-search-result-row:focus-within{background:var(--dvw-hover)}
.dvw-search-result-row>button:first-child{border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:4px;height:100%;min-width:0;flex:1}
.dvw-result-file{padding:0 2px 0 5px}
.dvw-result-file span:not(.codicon),.dvw-result-file small,.dvw-preview{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvw-result-file small{min-width:0;flex:1;color:var(--dvw-text-2)}
.dvw-result-file b{font-size:10px;font-weight:500;padding:1px 5px;border-radius:8px;background:var(--dvw-active)}
.dvw-result{padding:0 0 0 20px}
.dvw-result .dvw-line{min-width:1.5em;text-align:right;color:var(--dvw-text-2);font-variant-numeric:tabular-nums}
.dvw-preview{white-space:pre}
.dvw-preview mark,.dvw-preview ins{background:color-mix(in srgb,var(--dvw-accent) 28%,transparent);color:inherit}
.dvw-preview mark[data-replace=true]{text-decoration:line-through;background:color-mix(in srgb,var(--dvw-error) 25%,transparent)}
.dvw-preview ins{text-decoration:none;background:color-mix(in srgb,var(--dvw-success) 30%,transparent)}
.dvw-search .dvw-result-action{opacity:0;width:20px;height:20px}
.dvw-search-result-row:is(:hover,:focus-within) .dvw-result-action{opacity:1}
.dvw-debug{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dvw-text);font:12px/1.5 var(--dvw-font,system-ui)}
.dvw-debug-toolbar{display:flex;align-items:center;gap:4px;padding:4px 8px;border-bottom:1px solid var(--dvw-border-soft)}
.dvw-debug-toolbar .dvw-icon{width:24px;height:22px;font-size:12px}
.dvw-status{min-width:0;white-space:nowrap;gap:clamp(4px,1%,18px)}
.dvw-status-git{min-width:min-content}
.dvw-scm-status .dvw-branch{min-width:0}
.dvw-status > span,.dvw-status-branch-name{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dvw-status-path{flex:1 1 auto}
.dvw-status>button,.dvw-scm-status .dvw-branch:not(:first-child){flex:none}
.dvw-status-warn{color:#b8860b;cursor:help;margin-left:8px}
.dvw-status-action{margin-left:8px;height:18px;padding:0 6px;border:1px solid var(--dvw-border-soft);border-radius:3px;background:transparent;color:inherit;font-size:11px;cursor:pointer}
.dvw-status-action:disabled{opacity:.4;cursor:default}
.dvw-status-action:hover:not(:disabled){background:var(--dvw-hover)}
.dvw-debug-primary{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;margin-right:2px;border:1px solid var(--dvw-border-soft);border-radius:4px;background:var(--dvw-accent);color:#fff;font-size:11px;cursor:pointer}
.dvw-debug-primary:disabled{opacity:.45;cursor:default}
.dvw-debug-state{color:var(--dvw-text-2);margin-left:4px}
.dvw-debug-select{margin-left:8px;background:transparent;color:inherit;border:1px solid var(--dvw-border-soft);border-radius:4px;font-size:11px;padding:1px 4px}
.dvw-debug-spacer{flex:1}
.dvw-debug-hint{color:var(--dvw-text-3);font-size:11px}
.dvw-debug-body{display:flex;flex:1;min-height:0}
.dvw-debug-column{display:flex;flex-direction:column;min-width:0;flex:1;border-right:1px solid var(--dvw-border-soft)}
.dvw-debug-column:last-child{border-right:0}
.dvw-debug-vars{flex:1.1}
.dvw-debug-console{flex:1.2}
.dvw-debug-head{display:flex;align-items:center;justify-content:space-between;padding:3px 8px;color:var(--dvw-text-2);border-bottom:1px solid var(--dvw-border-soft);font-size:11px}
.dvw-debug-list{flex:1;min-height:0;overflow:auto;padding:4px 0}
.dvw-debug-empty{color:var(--dvw-text-3);padding:8px;font-size:11px}
.dvw-debug-frame{display:flex;gap:8px;width:100%;background:transparent;border:0;color:inherit;text-align:left;padding:2px 8px;cursor:pointer}
.dvw-debug-frame:hover{background:var(--dvw-hover)}
.dvw-debug-frame[data-active]{background:var(--dvw-active)}
.dvw-debug-frame-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvw-debug-frame-where{color:var(--dvw-text-3);font-size:11px}
.dvw-debug-scope-head{display:block;width:100%;text-align:left;background:transparent;border:0;color:var(--dvw-text-2);padding:2px 8px;cursor:pointer}
.dvw-debug-scope-head[data-open]::before{content:'▾ '}
.dvw-debug-scope-head:not([data-open])::before{content:'▸ '}
.dvw-debug-var{display:flex;gap:6px;align-items:baseline;padding:1px 8px}
.dvw-debug-var:hover{background:var(--dvw-hover)}
.dvw-debug-expand{width:12px;background:transparent;border:0;color:var(--dvw-text-3);cursor:pointer;padding:0;font-size:10px}
.dvw-debug-var-name{color:var(--dvw-text-2)}
.dvw-debug-var-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dvw-text)}
.dvw-debug-var-type{color:var(--dvw-text-3);font-size:10px}
.dvw-debug-watch{display:flex;gap:4px;padding:2px 8px}
.dvw-debug-watch input{flex:1;min-width:0;background:transparent;border:1px solid var(--dvw-border-soft);border-radius:3px;color:inherit;padding:1px 4px;font-size:11px}
.dvw-debug-log{font-family:var(--dvw-mono,monospace);font-size:11px}
.dvw-debug-line{padding:1px 8px;white-space:pre-wrap;word-break:break-word}
.dvw-debug-line[data-kind=input]{color:var(--dvw-text-2)}
.dvw-debug-line[data-kind=error]{color:#cd4c46}
.dvw-debug-prompt{padding:4px 8px;border-top:1px solid var(--dvw-border-soft)}
.dvw-debug-prompt input{width:100%;background:transparent;border:1px solid var(--dvw-border-soft);border-radius:3px;color:inherit;padding:2px 6px;font-family:var(--dvw-mono,monospace);font-size:11px}
.dvw-debug-foot{display:flex;gap:6px;align-items:center;padding:4px 8px;border-top:1px solid var(--dvw-border-soft)}
.dvw-debug-foot input{flex:1;background:transparent;border:1px solid var(--dvw-border-soft);border-radius:3px;color:inherit;padding:2px 6px;font-size:11px}
.dvw-debug-breakpoint{position:relative}
.dvw-debug-breakpoint::before{content:'';position:absolute;left:1px;top:50%;width:8px;height:8px;margin-top:-4px;border-radius:50%;background:#cd4c46}
.dvw-debug-paused-arrow{position:relative}
.dvw-debug-paused-arrow::before{content:'▶';position:absolute;left:0;top:50%;transform:translateY(-50%);color:#e0a020;font-size:9px;line-height:1}
.dvw-debug-paused-line{background:color-mix(in srgb,var(--dvw-accent) 14%,transparent)}

/* SSH workspace */
.dvw-ssh{--dvw-ssh-font:12px;--dvw-ssh-font-small:11px;--dvw-ssh-font-caption:10px;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--dvw-side);color:var(--dvw-text);font-size:var(--dvw-ssh-font);overflow:hidden}
.dvw-ssh[hidden]{display:none}
.dvw-ssh-error{flex:none;margin:8px 8px 0;padding:7px 7px 7px 9px;border:1px solid color-mix(in srgb,var(--dvw-error) 35%,var(--dvw-border));border-radius:6px;background:color-mix(in srgb,var(--dvw-error) 9%,var(--dvw-surface-1));color:var(--dvw-error);font-size:var(--dvw-ssh-font);line-height:1.45;display:flex;align-items:flex-start;gap:5px}
.dvw-ssh-error span{min-width:0;flex:1;overflow-wrap:anywhere}
.dvw-ssh-error .dvw-icon{flex:none;width:20px;min-width:20px;height:20px;color:inherit}
.dvw-ssh-connect{flex:1;min-height:0;overflow:auto;padding:10px 9px 16px;scrollbar-gutter:stable}
.dvw-ssh-hero{display:flex;align-items:flex-start;gap:9px;padding:10px;border:1px solid var(--dvw-border-soft);border-radius:8px;background:linear-gradient(145deg,color-mix(in srgb,var(--dvw-accent) 8%,var(--dvw-surface-2)),var(--dvw-surface-1))}
.dvw-ssh-hero-icon{flex:none;width:30px;height:30px;display:grid;place-items:center;border-radius:7px;background:color-mix(in srgb,var(--dvw-accent) 15%,var(--dvw-surface-2));color:var(--dvw-accent);font-size:16px}
.dvw-ssh-hero>div{min-width:0;display:flex;flex-direction:column;gap:3px}
.dvw-ssh-hero strong{font-size:13px;font-weight:650;line-height:1.3}
.dvw-ssh-hero small{color:var(--dvw-text-2);font-size:var(--dvw-ssh-font-small);line-height:1.45}
.dvw-ssh-mode-switch{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin:10px 0 8px;padding:2px;border:1px solid var(--dvw-border-soft);border-radius:7px;background:var(--dvw-surface-2)}
.dvw-ssh-mode-switch button{height:30px;border:0;border-radius:5px;background:transparent;color:var(--dvw-text-2);font:inherit;font-size:var(--dvw-ssh-font);cursor:pointer}
.dvw-ssh-mode-switch button:hover{color:var(--dvw-text);background:var(--dvw-hover)}
.dvw-ssh-mode-switch button[data-active=true]{background:var(--dvw-surface-1);box-shadow:0 1px 4px rgba(0,0,0,.18),inset 0 0 0 1px var(--dvw-border-soft);color:var(--dvw-text);font-weight:600}
.dvw-ssh-picker{display:flex;flex-direction:column;gap:9px;margin-bottom:10px}
.dvw-ssh-picker-section{min-width:0}
.dvw-ssh-picker-label{height:26px;display:flex;align-items:center;gap:6px;color:var(--dvw-text-2);font-size:var(--dvw-ssh-font);font-weight:650;letter-spacing:.02em}
.dvw-ssh-picker-label small{margin-left:auto;min-width:20px;height:18px;display:grid;place-items:center;padding:0 5px;border-radius:9px;background:var(--dvw-active);color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-caption);font-variant-numeric:tabular-nums}
.dvw-ssh-host-list{max-height:164px;overflow:auto;border:1px solid var(--dvw-border-soft);border-radius:7px;background:var(--dvw-surface-1)}
.dvw-ssh-host-list:empty{display:none}
.dvw-ssh-host-main{width:100%;min-width:0;height:42px;display:flex;align-items:center;gap:8px;padding:0 8px;border:0;border-bottom:1px solid var(--dvw-border-soft);background:transparent;color:var(--dvw-text-2);font:inherit;text-align:left;cursor:pointer}
.dvw-ssh-host-list>.dvw-ssh-host-main:last-child{border-bottom:0}
.dvw-ssh-host-main:hover{background:var(--dvw-hover);color:var(--dvw-text)}
.dvw-ssh-host-main[data-active=true]{background:color-mix(in srgb,var(--dvw-accent) 10%,var(--dvw-surface-1));color:var(--dvw-text);box-shadow:inset 2px 0 var(--dvw-accent)}
.dvw-ssh-host-main>.codicon{flex:none;width:17px;color:var(--dvw-accent);font-size:15px}
.dvw-ssh-host-main>span{min-width:0;flex:1;display:grid;gap:1px}
.dvw-ssh-host-main strong,.dvw-ssh-host-main small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-host-main strong{color:inherit;font-size:var(--dvw-ssh-font);font-weight:600}
.dvw-ssh-host-main small{color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-small);font-weight:400}
.dvw-ssh-recent{display:grid;grid-template-columns:minmax(0,1fr) 24px;align-items:stretch;border-bottom:1px solid var(--dvw-border-soft)}
.dvw-ssh-recent:last-child{border-bottom:0}
.dvw-ssh-recent .dvw-ssh-host-main{border-bottom:0}
.dvw-ssh-recent>.dvw-icon{align-self:center;width:20px;height:20px;margin-right:2px;opacity:0}
.dvw-ssh-recent:hover>.dvw-icon,.dvw-ssh-recent:focus-within>.dvw-icon{opacity:1}
.dvw-ssh-empty-card{display:flex;flex-direction:column;align-items:center;gap:5px;padding:15px 10px;border:1px dashed var(--dvw-border);border-radius:8px;color:var(--dvw-text-3);text-align:center}
.dvw-ssh-empty-card>.codicon{font-size:22px;color:var(--dvw-text-2)}
.dvw-ssh-empty-card strong{font-size:var(--dvw-ssh-font);color:var(--dvw-text-2)}
.dvw-ssh-empty-card span{font-size:var(--dvw-ssh-font-small);line-height:1.45}
.dvw-ssh-form{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dvw-border-soft);border-radius:8px;background:var(--dvw-surface-1)}
.dvw-ssh-form-title{min-width:0;display:flex;align-items:center;gap:6px;margin-bottom:1px}
.dvw-ssh-form-title strong{flex:none;font-size:var(--dvw-ssh-font);font-weight:650}
.dvw-ssh-form-title span{min-width:0;margin-left:auto;overflow:hidden;color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-caption);text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-form label{min-width:0;display:flex;flex-direction:column;gap:3px;color:var(--dvw-text-2);font-size:var(--dvw-ssh-font-small);font-weight:500}
.dvw-ssh-form .dvw-input{height:30px;padding:3px 7px;background:var(--dvw-surface-2);font:inherit;font-size:var(--dvw-ssh-font)}
.dvw-ssh-form-grid{display:grid;grid-template-columns:minmax(0,1fr) 66px;gap:7px}
.dvw-ssh-advanced{border-top:1px solid var(--dvw-border-soft);padding-top:7px}
.dvw-ssh-advanced summary,.dvw-ssh-security summary{list-style:none;display:flex;align-items:center;gap:5px;color:var(--dvw-text-2);font-size:var(--dvw-ssh-font-small);cursor:pointer;user-select:none}
.dvw-ssh-advanced summary::-webkit-details-marker,.dvw-ssh-security summary::-webkit-details-marker{display:none}
.dvw-ssh-advanced summary::before,.dvw-ssh-security summary::before{content:"›";display:inline-block;color:var(--dvw-text-3);font-size:15px;line-height:1;transform:rotate(0)}
.dvw-ssh-advanced[open] summary::before,.dvw-ssh-security[open] summary::before{transform:rotate(90deg)}
.dvw-ssh-advanced[open]{display:flex;flex-direction:column;gap:7px}
.dvw-ssh-security{padding-top:1px}
.dvw-ssh-security p{margin:5px 0 0 11px;color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-caption);line-height:1.5}
.dvw-ssh-primary{height:32px;border:0;border-radius:6px;background:var(--dvw-accent);color:#fff;display:flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-size:var(--dvw-ssh-font);font-weight:600;cursor:pointer}
.dvw-ssh-primary:hover:not(:disabled){filter:brightness(1.08)}
.dvw-ssh-primary:disabled{opacity:.48;cursor:default}
.dvw-ssh-connect-button{margin-top:1px}
.dvw-ssh-connected{flex:1;min-height:0;display:flex;flex-direction:column}
.dvw-ssh-connection-card{flex:none;min-width:0;display:grid;grid-template-columns:26px minmax(0,1fr) auto;align-items:center;gap:8px;margin:8px 9px 7px;padding:9px;border:1px solid var(--dvw-border-soft);border-radius:8px;background:linear-gradient(145deg,color-mix(in srgb,var(--dvw-success) 7%,var(--dvw-surface-2)),var(--dvw-surface-1))}
.dvw-ssh-online{width:25px;height:25px;display:grid;place-items:center;border-radius:50%;background:color-mix(in srgb,var(--dvw-success) 14%,transparent);color:var(--dvw-success)}
.dvw-ssh-connection-card>div:not(.dvw-ssh-online){min-width:0;display:grid;gap:1px}
.dvw-ssh-connection-card strong,.dvw-ssh-connection-card small,.dvw-ssh-connection-card code{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-connection-card strong{font-size:var(--dvw-ssh-font);font-weight:650}
.dvw-ssh-connection-card small{color:var(--dvw-text-2);font-size:var(--dvw-ssh-font-small)}
.dvw-ssh-connection-card code{margin-top:1px;color:var(--dvw-text-3);font:var(--dvw-ssh-font-caption)/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dvw-ssh-terminal-button{height:28px;display:flex;align-items:center;gap:4px;padding:0 7px;border:1px solid var(--dvw-border);border-radius:5px;background:var(--dvw-surface-2);color:var(--dvw-text-2);font:inherit;font-size:var(--dvw-ssh-font-small);cursor:pointer}
.dvw-ssh-terminal-button:hover{background:var(--dvw-hover);color:var(--dvw-text)}
.dvw-ssh-panel[hidden],.dvw-ssh-tree-section[hidden]{display:none}
.dvw-ssh-tree-error{display:flex;align-items:center;justify-content:space-between;gap:4px;padding:4px 8px;color:var(--dvw-error);overflow-wrap:anywhere}
.dvw-ssh-panel{flex:1;min-height:0;display:flex;overflow:hidden}
.dvw-ssh-workspace-section{flex:none;min-height:30px;display:flex;flex-direction:column;border-bottom:1px solid var(--dvw-border-soft)}
.dvw-ssh-workspace-section[data-expanded=true]{flex:1;min-height:120px}
.dvw-ssh-section{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.dvw-ssh-panel-toolbar{flex:none;height:31px;display:flex;align-items:center;gap:5px;padding:0 5px 0 9px;border-bottom:1px solid var(--dvw-border-soft);background:var(--dvw-side)}
.dvw-ssh-panel-toolbar>span{min-width:0;flex:1;display:flex;align-items:center;gap:5px;overflow:hidden;color:var(--dvw-text-2);font-size:var(--dvw-ssh-font);font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-panel-toolbar>span>.codicon{color:var(--dvw-accent);font-size:13px}
.dvw-ssh-panel-toolbar small{color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-caption);font-weight:400}
.dvw-ssh-tree{flex:1;min-height:0;overflow:auto;padding:3px 0 8px}
.dvw-ssh-tree-row{height:26px;display:flex;align-items:center;gap:4px;padding-right:6px;cursor:pointer;white-space:nowrap}
.dvw-ssh-tree-row:hover{background:var(--dvw-hover)}
.dvw-ssh-tree-name{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dvw-ssh-empty{padding:18px 10px;color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-small);text-align:center}
.dvw-ssh-spinner{width:11px;height:11px;margin-left:auto;flex:none;border:1px solid color-mix(in srgb,var(--dvw-accent) 26%,transparent);border-top-color:var(--dvw-accent);border-radius:50%;animation:dvw-spin .8s linear infinite}
.dvw-ssh-search{flex:none;display:flex;flex-direction:column;gap:5px;padding:7px 7px 6px;border-bottom:1px solid var(--dvw-border-soft)}
.dvw-ssh-search .dvw-search-box{height:30px}
.dvw-ssh-search-status{min-height:16px;color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-small);line-height:16px;white-space:pre-wrap;overflow-wrap:anywhere}
.dvw-ssh-search-status:empty{display:none}
.dvw-ssh-results{flex:1;min-height:0;overflow:auto;padding:2px 0 8px}
.dvw-ssh-results details{border-bottom:1px solid var(--dvw-border-soft)}
.dvw-ssh-results summary{height:28px;display:flex;align-items:center;gap:5px;padding:0 7px;color:var(--dvw-text);font-size:var(--dvw-ssh-font);cursor:pointer;white-space:nowrap}
.dvw-ssh-results summary:hover{background:var(--dvw-hover)}
.dvw-ssh-results summary span{min-width:0;overflow:hidden;color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-caption);text-overflow:ellipsis}
.dvw-ssh-results summary b{margin-left:auto;color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-caption);font-weight:500}
.dvw-ssh-result{width:100%;min-height:25px;display:grid;grid-template-columns:29px minmax(0,1fr);gap:4px;padding:2px 7px 2px 15px;border:0;background:transparent;color:var(--dvw-text-2);font:var(--dvw-ssh-font-small)/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:left;cursor:pointer;white-space:nowrap}
.dvw-ssh-result:hover{background:var(--dvw-hover);color:var(--dvw-text)}
.dvw-ssh-result span{overflow:hidden;color:var(--dvw-text-3);text-align:right;text-overflow:ellipsis}
.dvw-ssh-result:not(span){overflow:hidden;text-overflow:ellipsis}
.dvw-ssh-git-error{margin:7px;padding:6px 7px;border-radius:5px;background:color-mix(in srgb,var(--dvw-error) 9%,transparent);color:var(--dvw-error);font-size:var(--dvw-ssh-font-small);overflow-wrap:anywhere}
.dvw-ssh-commit{flex:none;display:flex;flex-direction:column;gap:5px;padding:7px}
.dvw-ssh-commit .dvw-textarea{min-height:50px;resize:vertical;padding:5px 6px;background:var(--dvw-surface-2);font-family:inherit;font-size:var(--dvw-ssh-font);line-height:1.35}
.dvw-ssh-commit>div{display:flex;align-items:center;gap:4px}
.dvw-ssh-commit .dvw-ssh-primary{height:30px;margin-left:auto;padding:0 9px}
.dvw-ssh-git-group{flex:none;padding-bottom:5px}
.dvw-ssh-git-group>strong{height:26px;display:flex;align-items:center;gap:4px;padding:0 5px 0 9px;color:var(--dvw-text-2);font-size:var(--dvw-ssh-font);font-weight:600}
.dvw-ssh-git-group>strong .dvw-icon{width:20px;min-width:20px;height:20px}
.dvw-ssh-git-group>strong>span{margin-left:auto;min-width:20px;height:18px;display:grid;place-items:center;border-radius:9px;background:var(--dvw-active);font-size:var(--dvw-ssh-font-caption);font-weight:500}
.dvw-ssh-git-row{height:26px;display:flex;align-items:center;gap:5px;padding:0 5px 0 16px;cursor:pointer}
.dvw-ssh-git-row:hover{background:var(--dvw-hover)}
.dvw-ssh-git-row>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dvw-ssh-font)}
.dvw-ssh-git-row .dvw-file-icon{width:16px;height:16px}
.dvw-ssh-git-row .dvw-icon{width:20px;min-width:20px;height:20px;opacity:0}
.dvw-ssh-git-row:hover .dvw-icon,.dvw-ssh-git-row:focus-within .dvw-icon{opacity:1}
.dvw-ssh-secondary{height:30px;margin:5px 7px 8px;border:1px solid var(--dvw-border);border-radius:5px;background:var(--dvw-surface-2);color:var(--dvw-text);font:inherit;font-size:var(--dvw-ssh-font);cursor:pointer}
.dvw-ssh-secondary:hover{background:var(--dvw-hover)}
@keyframes dvw-spin{to{transform:rotate(360deg)}}

/* VS Code-style remote explorer target list and quick input */
.dvw-ssh-targets{flex:0 0 auto;min-height:56px;max-height:calc(100% - 180px);display:flex;flex-direction:column;border-bottom:1px solid var(--dvw-border-soft)}
.dvw-ssh-targets[data-collapsed=true]{flex-basis:30px!important;height:30px;min-height:30px;max-height:30px}
.dvw-ssh-targets-resizer{position:relative;z-index:6;flex:0 0 6px;margin-block:-3px;cursor:ns-resize;touch-action:none}
.dvw-ssh-targets-resizer::after{content:"";position:absolute;inset:2px 0 auto;height:1px;background:var(--dvw-border);pointer-events:none}
.dvw-ssh-targets-resizer:is(:hover,:focus-visible,[data-dragging=true])::after{height:2px;background:var(--dvw-accent)}
.dvw-ssh-section-head{flex:none;font-size:13px}
.dvw-ssh-section-toggle>span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-target-row>.dvw-icon{width:20px;min-width:20px;height:20px}
.dvw-ssh-target-list{flex:1;min-height:0;overflow:auto;padding:0 0 4px}
.dvw-ssh-target-row{min-width:0;display:grid;grid-template-columns:minmax(0,1fr) repeat(3,20px);align-items:center;padding-right:4px}
.dvw-ssh-target-row:hover{background:var(--dvw-hover)}
.dvw-ssh-target-main{grid-column:1;min-width:0;height:30px;display:flex;align-items:center;gap:7px;padding:0 4px 0 11px;border:0;background:transparent;color:var(--dvw-text-2);font:inherit;text-align:left;cursor:pointer}
.dvw-ssh-target-main:hover:not(:disabled){color:var(--dvw-text)}
.dvw-ssh-target-main:disabled{opacity:.62;cursor:default}
.dvw-ssh-target-main[data-connected=true]{color:var(--dvw-text)}
.dvw-ssh-target-main>.codicon{flex:none;width:16px;color:var(--dvw-accent);font-size:14px}
.dvw-ssh-target-main[data-connected=true]>.codicon{color:var(--dvw-success)}
.dvw-ssh-target-main>span{min-width:0;flex:1}
.dvw-ssh-target-main strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-target-main strong{color:inherit;font-size:var(--dvw-ssh-font);font-weight:600}
.dvw-ssh-target-main em{flex:none;padding:1px 5px;border-radius:9px;background:color-mix(in srgb,var(--dvw-success) 13%,transparent);color:var(--dvw-success);font-size:var(--dvw-ssh-font-caption);font-style:normal;line-height:16px}
.dvw-ssh-target-row>.dvw-icon{opacity:0}
.dvw-ssh-target-row:hover>.dvw-icon,.dvw-ssh-target-row:focus-within>.dvw-icon{opacity:1}
.dvw-ssh-empty-target{width:calc(100% - 12px);height:32px;margin:1px 6px 4px;display:flex;align-items:center;gap:7px;padding:0 7px;border:0;border-radius:4px;background:transparent;color:var(--dvw-text-2);font:inherit;font-size:var(--dvw-ssh-font-small);text-align:left;cursor:pointer}
.dvw-ssh-empty-target:hover{background:var(--dvw-hover);color:var(--dvw-text)}
.dvw-ssh-quickpick-backdrop{position:fixed;inset:0;z-index:150;display:flex;align-items:flex-start;justify-content:center;padding:calc(var(--dvw-titlebar-height) + 76px) 20px 20px;background:rgba(0,0,0,.18);backdrop-filter:blur(1px)}
.dvw-ssh-dialog-layer{--dvw-base:var(--dsw-alias-bg-base,#fff);--dvw-surface-1:var(--dsw-alias-bg-layer-1,#fff);--dvw-surface-2:var(--dsw-alias-bg-layer-2,#fff);--dvw-surface-3:var(--dsw-alias-bg-layer-3,#f5f6f7);--dvw-text:var(--dsw-alias-label-primary,#171717);--dvw-text-2:var(--dsw-alias-label-secondary,#5c5c5c);--dvw-text-3:var(--dsw-alias-label-tertiary,#6e6e6e);--dvw-border:var(--dsw-alias-border-l2,#dedede);--dvw-border-soft:var(--dsw-alias-border-l3,#ececec);--dvw-hover:var(--dsw-alias-interactive-bg-hover,#0000000c);--dvw-accent:var(--dsw-alias-state-business-primary,#3b82f6);--dvw-ssh-font:13px;--dvw-ssh-font-small:12px;--dvw-ssh-font-caption:11px;z-index:250;align-items:center;padding:calc(var(--dvw-titlebar-height) + 20px) 20px 20px;color:var(--dvw-text);font:13px/1.4 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}
.dvw-ssh-dialog-layer *{box-sizing:border-box}
.dvw-ssh-dialog-layer .dvw-ssh-quickpick{max-width:100%;max-height:100%;flex:none}
.dvw-ssh-dialog-layer button:focus-visible,.dvw-ssh-dialog-layer input:focus-visible,.dvw-ssh-dialog-layer summary:focus-visible{outline:1px solid var(--dvw-accent);outline-offset:2px}
.dvw-ssh-quickpick{width:min(620px,calc(100vw - 40px));max-height:min(680px,calc(100vh - 120px));display:flex;flex-direction:column;border:1px solid color-mix(in srgb,var(--dvw-border) 82%,transparent);border-radius:12px;background:var(--dvw-surface-1);color:var(--dvw-text);box-shadow:0 16px 40px #0005,0 2px 8px #0003;overflow:hidden}
.dvw-ssh-quickpick-head{flex:none;height:34px;display:flex;align-items:center;padding:0 7px 0 12px;border-bottom:1px solid var(--dvw-border-soft);background:var(--dvw-base)}
.dvw-ssh-quickpick-head strong{min-width:0;flex:1;overflow:hidden;font-size:13px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-quickpick-body{min-height:0;overflow:auto;padding:10px 12px 13px}
.dvw-ssh-quickpick-input{display:flex;flex-direction:column;gap:5px;color:var(--dvw-text-2);font-size:var(--dvw-ssh-font-small)}
.dvw-ssh-quickpick-input input{width:100%;height:34px;padding:0 10px;border:1px solid var(--dvw-border);border-radius:6px;background:var(--dvw-surface-2);color:var(--dvw-text);font:inherit;font-size:var(--dvw-ssh-font);outline:0;transition:border-color 120ms ease,box-shadow 120ms ease}
.dvw-ssh-quickpick-input input:focus{border-color:var(--dvw-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dvw-accent) 14%,transparent)}
.dvw-ssh-quickpick-body>small{display:block;margin-top:6px;color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-caption)}
.dvw-ssh-auth-method{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:12px;padding-top:12px;border-top:1px solid var(--dvw-border-soft)}
.dvw-ssh-credentials{display:grid;gap:8px;margin-top:10px}
.dvw-ssh-credentials label{min-width:0}
.dvw-ssh-remember-password{display:flex;align-items:center;gap:6px;font-size:var(--dvw-ssh-font-small);color:var(--dvw-text-2)}
.dvw-ssh-remember-password input{margin:0;accent-color:var(--dvw-accent)}
.dvw-ssh-auth-method label{display:flex;flex-direction:column;gap:3px}
.dvw-ssh-auth-method strong{font-size:var(--dvw-ssh-font-small);font-weight:600}
.dvw-ssh-auth-method small{color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-caption)}
.dvw-ssh-auth-method select{min-width:112px;height:32px;padding:0 28px 0 10px;border:1px solid var(--dvw-border);border-radius:6px;background:var(--dvw-surface-2);color:var(--dvw-text);font:inherit;cursor:pointer}
.dvw-ssh-quickpick-body>.dvw-ssh-save-hint{margin-top:10px;line-height:1.5}
.dvw-ssh-quickpick-options{margin-top:11px;padding-top:9px;border-top:1px solid var(--dvw-border-soft)}
.dvw-ssh-quickpick-options summary{list-style:none;display:flex;align-items:center;gap:4px;color:var(--dvw-text-2);font-size:var(--dvw-ssh-font-small);cursor:pointer;user-select:none}
.dvw-ssh-quickpick-options summary::-webkit-details-marker{display:none}
.dvw-ssh-quickpick-options summary::before{content:"›";color:var(--dvw-text-3);font-size:15px;line-height:1;transition:transform 100ms ease}
.dvw-ssh-quickpick-options[open] summary::before{transform:rotate(90deg)}
.dvw-ssh-quickpick-options[open]{display:grid;gap:8px}
.dvw-ssh-quickpick-options label{display:flex;flex-direction:column;gap:4px;color:var(--dvw-text-2);font-size:var(--dvw-ssh-font-small)}
.dvw-ssh-quickpick-options .dvw-input{height:31px;border-radius:6px;font-size:var(--dvw-ssh-font)}
.dvw-ssh-quickpick-actions{flex:none;min-height:45px;display:flex;align-items:center;justify-content:flex-end;gap:7px;padding:7px 10px;border-top:1px solid var(--dvw-border-soft);background:var(--dvw-base)}
.dvw-ssh-quickpick-actions>button:not(.dvw-ssh-primary){height:30px;padding:0 12px;border:1px solid var(--dvw-border);border-radius:6px;background:var(--dvw-surface-2);color:var(--dvw-text);font:inherit;font-size:var(--dvw-ssh-font);cursor:pointer}
.dvw-ssh-quickpick-actions>button:not(.dvw-ssh-primary):hover:not(:disabled){background:var(--dvw-hover)}
.dvw-ssh-quickpick-actions>.dvw-ssh-primary{width:auto;min-width:84px;height:30px;padding:0 12px}
.dvw-ssh-quickpick-actions button:disabled{opacity:.48;cursor:default}
.dvw-ssh-connection-dialog{border:0;padding:0;background:transparent;max-width:calc(100% - 32px);overflow:visible}
.dvw-ssh-connection-dialog::backdrop{background:rgba(0,0,0,.24)}
.dvw-ssh-connection-dialog>.dvw-ssh-quickpick{width:min(440px,calc(100vw - 40px));max-width:100%;font-size:var(--dvw-ssh-font)}
.dvw-ssh-connection-message{margin:0;overflow-wrap:anywhere}
.dvw-ssh-connection-detail{margin:0;padding:8px 10px;max-height:200px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:4px;background:var(--dvw-surface-2);color:var(--dvw-text);font:11px/1.5 monospace;user-select:text}
[data-dvw-ssh-chat-status]{overflow:hidden!important;scrollbar-width:none}
[data-dvw-ssh-chat-status]::-webkit-scrollbar{display:none}
[data-dvw-ssh-chat-status]>button:not(.dvw-ssh-chat-host *){min-width:0;max-width:100px;overflow:hidden}
[data-dvw-ssh-chat-status]>button:not(.dvw-ssh-chat-host *) span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-chat-host{position:relative;z-index:1;display:flex;flex:1 0 116px;justify-content:flex-start;min-width:116px;max-width:150px;margin-right:4px}
.dvw-ssh-chat-target{position:relative;min-width:0;max-width:100%;margin:0;color:var(--dsw-alias-label-secondary,var(--dvw-text-2,#666))}
.dvw-ssh-chat-trigger{display:inline-flex;align-items:center;gap:4px;width:100%;max-width:100%;height:24px;padding:2px 5px;border:0;border-radius:4px;background:transparent;color:inherit;font:11px/1.4 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);cursor:pointer}
.dvw-ssh-chat-trigger>.codicon{flex:none;font-size:12px}
.dvw-ssh-chat-trigger>span:not(.codicon){flex:none;overflow:visible;text-overflow:clip;white-space:nowrap}
.dvw-ssh-chat-trigger:hover,.dvw-ssh-chat-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,var(--dvw-hover,#8882))}
.dvw-ssh-chat-menu{position:fixed;z-index:1000;inset:auto;box-sizing:border-box;min-width:0;max-width:calc(100vw - 24px);max-height:40vh;padding:8px;overflow:auto;border:1px solid color-mix(in srgb,var(--dvw-chat--dsw-alias-border-l3,#333) 60%,transparent);border-radius:12px;color:var(--dvw-chat--dsw-alias-label-primary,#ddd);background:var(--dvw-chat--dsw-alias-bg-layer-2,#252526);box-shadow:0 16px 40px #0004,0 2px 6px #0002;font-family:var(--dvw-chat--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);font-size:12px;isolation:isolate}
.dvw-ssh-chat-menu button{display:flex;align-items:center;gap:8px;width:100%;height:34px;min-width:0;padding:0 8px;border:0;border-radius:6px;overflow:hidden;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dvw-ssh-chat-menu button:hover{background:var(--dvw-chat--dsw-alias-interactive-bg-hover,#ffffff12)}
.dvw-ssh-chat-menu button>span:not(.codicon){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-chat-menu button small{max-width:50%;overflow:hidden;color:var(--dvw-chat--dsw-alias-label-secondary,#aaa);font-size:11px;font-weight:400;text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-entry-dialog{width:min(400px,calc(100vw - 40px))}
.dvw-ssh-workspace-picker{width:min(560px,calc(100vw - 40px))}
.dvw-ssh-workspace-location{height:34px;display:flex;align-items:center;gap:6px;padding:0 5px 0 7px;border:1px solid var(--dvw-border);border-radius:5px;background:var(--dvw-surface-2)}
.dvw-ssh-workspace-location>.codicon{flex:none;color:var(--dvw-accent);font-size:14px}
.dvw-ssh-workspace-location code{min-width:0;flex:1;overflow:hidden;color:var(--dvw-text);font:var(--dvw-ssh-font)/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-workspace-note{margin:7px 2px 9px;color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-small);line-height:1.45}
.dvw-ssh-workspace-folders{max-height:min(390px,50vh);overflow:auto;border:1px solid var(--dvw-border-soft);border-radius:6px;background:var(--dvw-surface-2)}
.dvw-ssh-workspace-folders>button{width:100%;height:31px;padding:0 8px;border:0;border-bottom:1px solid var(--dvw-border-soft);background:transparent;color:var(--dvw-text-2);display:flex;align-items:center;gap:7px;font:inherit;font-size:var(--dvw-ssh-font);text-align:left;cursor:pointer}
.dvw-ssh-workspace-folders>button:last-child{border-bottom:0}
.dvw-ssh-workspace-folders>button:hover,.dvw-ssh-workspace-folders>button:focus-visible{background:var(--dvw-hover);color:var(--dvw-text);outline:0}
.dvw-ssh-workspace-folders>button>.codicon:first-child{flex:none;color:var(--dvw-accent);font-size:14px}
.dvw-ssh-workspace-folders>button>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvw-ssh-workspace-folders>button>.codicon:last-child{flex:none;color:var(--dvw-text-3);font-size:12px}

/* SSH terminal */
.dvw-ssh-terminal{--dvw-ssh-font:12px;--dvw-ssh-font-small:11px;--dvw-ssh-font-caption:10px;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dvw-surface-1);color:var(--dvw-text);font-size:var(--dvw-ssh-font)}
.dvw-ssh-terminal-bar{flex:none;height:32px;display:flex;align-items:center;gap:10px;padding:0 8px 0 11px;border-bottom:1px solid var(--dvw-border-soft);background:var(--dvw-base);font-size:var(--dvw-ssh-font)}
.dvw-ssh-terminal-bar>span{display:flex;align-items:center;gap:5px;min-width:0}
.dvw-ssh-terminal-bar>span:first-child{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dvw-ssh-terminal-bar>span:nth-child(2){flex:none;color:var(--dvw-text-3);font-size:var(--dvw-ssh-font-small)}
.dvw-ssh-terminal-host{position:relative;flex:1;min-width:0;min-height:0;padding:7px 8px;overflow:hidden;background:var(--dvw-base)}
.dvw-ssh-terminal-host[hidden]{display:none}
.dvw-ssh-terminal-host .xterm{height:100%;position:relative;user-select:none;cursor:text}
.dvw-ssh-terminal-host .xterm.focus,.dvw-ssh-terminal-host .xterm:focus{outline:none}
.dvw-ssh-terminal-host .xterm-helpers{position:absolute;top:0;z-index:5}
.dvw-ssh-terminal-host .xterm-helper-textarea{position:absolute;padding:0;border:0;margin:0;opacity:0;left:-9999em;top:0;width:0;height:0;z-index:-5;white-space:nowrap;overflow:hidden;resize:none}
.dvw-ssh-terminal-host .xterm-viewport{position:absolute;inset:0;overflow-y:scroll;background-color:transparent;scrollbar-width:none}
.dvw-ssh-terminal-host .xterm-viewport::-webkit-scrollbar{display:none}
.dvw-ssh-terminal-host .xterm-screen{position:relative}
.dvw-ssh-terminal-host .composition-view{display:none;position:absolute;white-space:nowrap;z-index:1;background:var(--dvw-base);color:var(--dvw-text)}
.dvw-ssh-terminal-host .composition-view.active{display:block}
.dvw-ssh-terminal-host .xterm-char-measure-element{display:inline-block;visibility:hidden;position:absolute;left:-9999em;line-height:normal}
.dvw-ssh-terminal-host .xterm-cursor-pointer,.dvw-ssh-terminal-host .xterm .xterm-cursor-pointer{cursor:pointer}
.dvw-ssh-terminal-host .xterm-accessibility,.dvw-ssh-terminal-host .xterm-message{position:absolute;inset:0;z-index:10;color:transparent;pointer-events:none}
.dvw-ssh-terminal-host .xterm-accessibility-tree{position:absolute;left:0;top:0;width:100%;user-select:text;white-space:pre}
.dvw-ssh-terminal-host .xterm-accessibility-tree>div{position:absolute;transform-origin:top left}
.dvw-ssh-terminal-host canvas{position:absolute;left:0;top:0}
.dvw-ssh-terminal-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;color:var(--dvw-text-3);text-align:center}
.dvw-ssh-terminal-empty>.codicon{font-size:28px;color:var(--dvw-text-2)}
.dvw-ssh-terminal-empty strong{color:var(--dvw-text-2);font-size:14px}
.dvw-ssh-terminal-empty span{font-size:var(--dvw-ssh-font)}
@media(prefers-reduced-motion:reduce){.dvw-ssh-spinner{animation:none}}
.codicon-arrow-left:before{content:"\ea9b"}.codicon-arrow-right:before{content:"\ea9c"}.codicon-comment-discussion:before{content:"\eac7"}.codicon-copy:before{content:"\ebcc"}.codicon-chevron-up:before{content:"\eab7"}.codicon-link-external:before{content:"\eb14"}.codicon-history:before{content:"\ea82"}.codicon-tools:before{content:"\eb6d"}.codicon-play:before{content:"\eb2c"}.codicon-debug-stop:before{content:"\ead7"}.codicon-warning:before{content:"\ea6c"}.codicon-error:before{content:"\ea87"}.codicon-info:before{content:"\ea74"}.codicon-fold:before{content:"\eaf5"}.codicon-unfold:before{content:"\eb73"}.codicon-lock:before{content:"\ea75"}.codicon-remote:before{content:"\eb3a"}.codicon-remote-explorer:before{content:"\eb39"}.codicon-server:before{content:"\eb50"}.codicon-plug:before{content:"\eb2d"}.codicon-debug-disconnect:before{content:"\ead0"}.codicon-account:before{content:"\eb99"}
.dvw-side-head{height:37px;font-size:13px;font-weight:600;letter-spacing:.2px}
.dvw-side-head>strong{font-weight:inherit}
.dvw-explorer-head{padding:0 8px}
.dvw-explorer-head>strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvw-explorer-head>.dvw-toolbar{flex-shrink:0;gap:1px}
.dvw-explorer-head .dvw-icon{width:24px;padding:0}
.dvw-explorer-head .dvw-icon[aria-pressed=true]{background:var(--dvw-active);color:var(--dvw-text)}
.codicon-eye:before{content:"\ea70"}.codicon-eye-closed:before{content:"\eae7"}
.dvw-graph>.dvw-group-head{padding-left:4px}
.dvw-graph>.dvw-group-head>.dvw-group-toggle{padding-left:0;gap:3px}
.codicon-gripper:before{content:"\eb04"}
`

export function installStyles(): () => void {
  const id = 'dsh-vscode-workbench/styles'
  let tag = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${id}"]`)
  if (tag === null) { tag = document.createElement('style'); tag.dataset.pluginCss = id; tag.textContent = CSS; document.head.append(tag) }
  return () => { tag?.remove() }
}
