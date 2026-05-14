import Vue from 'vue'
import App from './App.vue'

new Vue({
  /**
   * 功能：
   * 作为 Vue 应用的根渲染函数，负责把根组件 `App` 挂载为整个页面的入口视图。
   *
   * 实现：
   * Vue 在实例初始化过程中会调用该函数，并把 `h(createElement)` 作为参数传入。
   * 这里直接返回 `App` 组件对应的虚拟节点，不在入口层叠加额外容器逻辑。
   *
   * 输入：
   * - `h`：Vue 传入的虚拟节点创建函数。
   *
   * 输出：
   * - 返回 `App` 组件的虚拟节点，交由 Vue 后续渲染到 DOM。
   */
  render: h => h(App),
}).$mount('#app')
