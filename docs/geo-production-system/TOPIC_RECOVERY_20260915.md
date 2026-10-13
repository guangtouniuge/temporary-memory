# 选题补齐与恢复状态

## 根因

用户截图对应 JOB-f03a55fd790e78b2c672fe54ab603e6b72f256a0，版本8.2.67。第4项第一次补齐返回有效id、businessProblem和readerSituation，但没有AI场景必需的customerIndustry。补齐系统示例未包含该字段，且错误提示错误归因于中心问题或编号。第二次已成功，任务继续运行，但第一次的failed工序仍显示红色中断。

## 修改

- 补齐JSON示例显式包含customerIndustry及场景理解。
- 提交partialBrief，要求保留已有问题，只补缺项。
- 分别提示编号、中心问题/读者场景、AI客户行业缺失。
- 相同修复输入的多次尝试用recoveryGroup关联；成功后将该组较早失败标记recovered，保留previousError诊断，不清除不相关错误。
- 页面显示“重试后已恢复”，不把已恢复步骤当成当前中断。
- 不更改标题、Skill、正文厚度、账户或额度。

## 验证记录

完整npm test通过，新增缺AI行业、第二次恢复、缓存复用测试。浏览器验证恢复状态展示，截图位于outputs/ui-workflow-mapping/task-handoffs.png。

使用本次10篇原始输入完成真实模型隔离批次，结果与检查点保存在.tmp/full-generation-20260915。receipt.json记录passed：10篇正文、25次文本模型调用、正文中断续跑通过、2张真实AI配图、生产写入0次。正文4518至7431字。全部选题交接、逐篇正文、已完成正文零调用重放及图片缓存复用均通过。两组4篇选题各有一次缺项，均在第一次补齐后继续完成，没有丢弃其他选题。

不创建生产客户任务、不扣会员额度。

## 上线验证

原生产任务于2026-09-15 13:54:12完成10/10篇，接口无正文0篇，error为空。确认无其他活动任务后部署8.2.68，未中断原任务。

- 发布目录：/www/wwwroot/geoskill.7chacha.com/releases/management-20260915-135512。
- 已验证数据备份可还原，备份目录：/root/.geoskill/backups/management-20260915-135512。
- 服务器完整性校验版本8.2.68，digest为c37bf3d38aa0b611004074949fd332464d5ea181a8dd7bd8488cef5282df567b。
- systemd实际启动路径指向本次目录，ActiveState=active。
- 线上页面加载本次前端index-CCNmeFiC.js；三处入口HTTP 200，匿名数据接口HTTP 401。
- 旧版本历史步骤没有recoveryGroup，不回写或伪造历史状态。本次修复对新版生成的补齐重试生效。
