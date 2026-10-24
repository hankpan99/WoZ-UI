// Actor 語句文件：修改引號內的文字，儲存後重新整理 Actor 畫面即可。
// {step}、{action}：主步驟字母（A、B…）；{name}：步驟名稱。
// {details}：本次選取的詳細動作，語音介入會以此替換「請…」。
// {partial}：這次只做該步驟的一部分詳細動作時才會出現，畫面上是紅字；全部都做就自動消失。
// 語音介入與模式 2 逐條產生：{number} 是原始詳細動作編號（01、02…），{detail} 是單條動作。
// label 是講話時機，text 是要說出的語句。
// when 決定流程分支，請保留：pending=詢問、accepted=接受、declined=拒絕、stop=參與者要求停止。
window.ACTOR_SPEECH = {
  // {partial} 會換成這幾個字（紅色顯示）。
  partial: "的部分動作",
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
    { label: "接收參與者指令", text: "：正在執行步驟 {step} {partial}" },
    { label: "完成", text: "：步驟已完成" },
    { label: "參與者要求停止", text: "：好的", when: "stop" },
  ],
  // 自訂實體介入：食譜上沒有的步驟，由控制台現場打字產生，所以沒有步驟字母。
  custom: [
    { label: "接收參與者指令", text: "：正在執行自訂步驟" },
    { label: "完成", text: "：步驟已完成" },
    { label: "參與者要求停止", text: "：好的", when: "stop" },
  ],
  inquiry: [
    { label: "詢問參與者", text: "：需要我幫你執行步驟 {step} {partial}嗎？", when: "pending" },
    { label: "參與者接受", text: "：正在執行步驟 {step} {partial}", when: "accepted" },
    { label: "完成", text: "：步驟已完成", when: "accepted" },
    // 拒絕與要求停止都是同一句「好的」，合成一張卡，流程圖維持兩行。
    { label: "參與者拒絕／要求停止", text: "：好的", when: "declined" },
  ],
  direct: [
    { label: "直接介入", text: "：正在執行步驟 {step} {partial}" },
    { label: "完成", text: "：步驟已完成" },
    { label: "參與者要求停止", text: "：好的", when: "stop" },
  ],
};
