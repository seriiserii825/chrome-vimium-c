import { showProjects } from './projects'

// Same panel as `tp`, but in the toolbar popup: opened via Alt+P (_execute_action),
// which Chrome handles itself, so it works where content scripts can't run (New Tab, chrome://).
void showProjects(false, () => window.close())
