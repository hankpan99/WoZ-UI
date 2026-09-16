// Actor 語句文件：修改引號內的文字，儲存後重新整理 Actor 畫面即可。
// {step}、{action}：主步驟字母（A、B…）；{name}：步驟名稱。
// {details}：本次選取的詳細動作，語音介入會以此替換「請…」。
// 語音介入與模式 2 逐條產生：{number} 是原始詳細動作編號（01、02…），{detail} 是單條動作。
// label 是講話時機，text 是要說出的語句。
// when 決定流程分支，請保留：pending=詢問、accepted=接受、declined=拒絕、stop=停止。
window.ACTOR_SPEECH = {
  explanation: {
    unrecognized: "無法辨識此指令",
    prerequisite: "前置步驟尚未完成，無法執行此步驟",
    stage: "請先完成此階段的所有步驟再往下",
  },
  voice_reminder: [
    { label: "動作 {number}", text: "：{detail}" },
  ],
  voice: [
    { label: "動作 {number}", text: "：{detail}" },
  ],
  physical: [
    { label: "接收參與者指令", text: "：正在執行步驟 {step}" },
    { label: "完成後", text: "：已完成此步驟" },
  ],
  inquiry: [
    { label: "詢問參與者", text: "：需要我幫你執行步驟 {step} 嗎？", when: "pending" },
    { label: "參與者接受", text: "：正在執行步驟 {step}", when: "accepted" },
    { label: "接受並完成後", text: "：已完成此步驟", when: "accepted" },
    { label: "參與者拒絕", text: "：停止執行步驟 {step}", when: "declined" },
  ],
  direct: [
    { label: "直接介入", text: "：正在執行步驟 {step}" },
    { label: "完成後", text: "：已完成此步驟" },
    { label: "參與者要求停止", text: "：停止執行步驟 {step}", when: "stop" },
  ],
};
