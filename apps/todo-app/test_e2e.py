import os
import sys
import time
from playwright.sync_api import sync_playwright

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://localhost:8085"
SCREENSHOT_DIR = r"C:\Users\Matheus Paes\Documents\ChatGPT\pub-acp-standalone\apps\todo-app\screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

def run_tests():
    results = []
    print("Iniciando bateria de testes end-to-end com Playwright + Chrome...")

    with sync_playwright() as p:
        # ==========================================
        # 1. TESTES EM VIEWPORT DESKTOP (1280x800)
        # ==========================================
        browser = p.chromium.launch(executable_path=CHROME_PATH, headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        # Abrir página
        page.goto(URL)
        page.wait_for_selector("#todo-form")
        
        # Limpar qualquer localStorage residual
        page.evaluate("() => localStorage.clear()")
        page.reload()
        page.wait_for_selector("#todo-form")

        # Validação 1: Estado Inicial Desktop
        page.screenshot(path=os.path.join(SCREENSHOT_DIR, "01_desktop_initial.png"))
        initial_empty = page.is_visible("#empty-state")
        results.append(("Estado Inicial (Vazio)", initial_empty))
        print(f"[Desktop] Estado Inicial: {'PASS' if initial_empty else 'FAIL'}")

        # Validação 2: Tentativa de Entrada Vazia (Validação amigável)
        page.click("#add-btn")
        err_visible = page.is_visible("#form-error.visible")
        err_text = page.text_content("#form-error").strip()
        has_error = err_visible and "informe a descrição" in err_text
        page.screenshot(path=os.path.join(SCREENSHOT_DIR, "02_empty_input_validation.png"))
        results.append(("Validação de Entrada Vazia", has_error))
        print(f"[Desktop] Validação Entrada Vazia: {'PASS' if has_error else 'FAIL'} -> Msg: '{err_text}'")

        # Validação 3: Adicionar Tarefas
        tasks_to_add = ["Comprar café e suprimentos", "Estudar arquitetura do pub-acp", "Revisar testes automatizados"]
        for task in tasks_to_add:
            page.fill("#todo-input", task)
            page.click("#add-btn")
            page.wait_for_timeout(100)

        items_count = page.locator("#todo-list li").count()
        total_stat = page.text_content("#stat-total").strip()
        add_ok = (items_count == 3 and total_stat == "3")
        page.screenshot(path=os.path.join(SCREENSHOT_DIR, "03_desktop_tasks_added.png"))
        results.append(("Adicionar Tarefas (3 tarefas)", add_ok))
        print(f"[Desktop] Adicionar Tarefas: {'PASS' if add_ok else 'FAIL'} (Qtd: {items_count})")

        # Validação 4: Concluir Tarefa
        first_checkbox = page.locator("#todo-list li:first-child .todo-checkbox")
        first_checkbox.click()
        page.wait_for_timeout(150)
        
        first_item_class = page.locator("#todo-list li:first-child").get_attribute("class")
        completed_stat = page.text_content("#stat-completed").strip()
        pending_stat = page.text_content("#stat-pending").strip()
        complete_ok = ("completed" in first_item_class and completed_stat == "1" and pending_stat == "2")
        page.screenshot(path=os.path.join(SCREENSHOT_DIR, "04_desktop_task_completed.png"))
        results.append(("Concluir Tarefa (Status e Contadores)", complete_ok))
        print(f"[Desktop] Concluir Tarefa: {'PASS' if complete_ok else 'FAIL'} (Concluídas: {completed_stat}, Pendentes: {pending_stat})")

        # Validação 5: Desconcluir Tarefa
        first_checkbox.click()
        page.wait_for_timeout(150)
        first_item_class_after = page.locator("#todo-list li:first-child").get_attribute("class")
        uncomplete_ok = ("completed" not in first_item_class_after and page.text_content("#stat-completed").strip() == "0")
        page.screenshot(path=os.path.join(SCREENSHOT_DIR, "05_desktop_task_uncompleted.png"))
        results.append(("Desconcluir Tarefa", uncomplete_ok))
        print(f"[Desktop] Desconcluir Tarefa: {'PASS' if uncomplete_ok else 'FAIL'}")

        # Concluir a segunda tarefa para testar filtros e persistência
        page.locator("#todo-list li:nth-child(2) .todo-checkbox").click()

        # Validação 6: Excluir Tarefa
        count_before_del = page.locator("#todo-list li").count()
        page.locator("#todo-list li:first-child .btn-delete").click()
        page.wait_for_timeout(150)
        count_after_del = page.locator("#todo-list li").count()
        delete_ok = (count_after_del == count_before_del - 1)
        page.screenshot(path=os.path.join(SCREENSHOT_DIR, "06_desktop_task_deleted.png"))
        results.append(("Excluir Tarefa", delete_ok))
        print(f"[Desktop] Excluir Tarefa: {'PASS' if delete_ok else 'FAIL'} (Antes: {count_before_del}, Depois: {count_after_del})")

        # Validação 7: Persistência após Reload da Página
        page.reload()
        page.wait_for_selector("#todo-list")
        count_after_reload = page.locator("#todo-list li").count()
        stat_total_reload = page.text_content("#stat-total").strip()
        stat_completed_reload = page.text_content("#stat-completed").strip()
        persist_ok = (count_after_reload == count_after_del and stat_total_reload == "2" and stat_completed_reload == "1")
        page.screenshot(path=os.path.join(SCREENSHOT_DIR, "07_desktop_persistence_reload.png"))
        results.append(("Persistência no LocalStorage após Reload", persist_ok))
        print(f"[Desktop] Persistência após Reload: {'PASS' if persist_ok else 'FAIL'} (Itens mantidos: {count_after_reload})")

        browser.close()

        # ==========================================
        # 2. TESTES EM VIEWPORT MOBILE (375x667 - iPhone SE)
        # ==========================================
        browser_mobile = p.chromium.launch(executable_path=CHROME_PATH, headless=True)
        mobile_context = browser_mobile.new_context(
            viewport={"width": 375, "height": 667},
            is_mobile=True,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1"
        )
        page_m = mobile_context.new_page()
        page_m.goto(URL)
        page_m.wait_for_selector("#todo-form")

        # Adicionar tarefa no mobile
        page_m.fill("#todo-input", "Tarefa criada no Mobile")
        page_m.click("#add-btn")
        page_m.wait_for_timeout(150)
        
        m_items = page_m.locator("#todo-list li").count()
        page_m.screenshot(path=os.path.join(SCREENSHOT_DIR, "08_mobile_viewport_layout.png"))
        mobile_ok = (m_items >= 1)
        results.append(("Responsividade Viewport Mobile (375x667)", mobile_ok))
        print(f"[Mobile] Viewport Mobile Test: {'PASS' if mobile_ok else 'FAIL'} (Qtd total itens: {m_items})")

        # Teste de Filtros no Mobile
        page_m.click("button[data-filter='completed']")
        page_m.wait_for_timeout(150)
        page_m.screenshot(path=os.path.join(SCREENSHOT_DIR, "09_mobile_filter_completed.png"))

        browser_mobile.close()

    print("\n--- RESUMO DOS TESTES ---")
    all_passed = True
    for name, passed in results:
        status = "PASSED" if passed else "FAILED"
        print(f"- {name}: {status}")
        if not passed:
            all_passed = False

    if not all_passed:
        sys.exit(1)
    print("\nTODOS OS TESTES FORAM CONCLUÍDOS COM SUCESSO!")

if __name__ == "__main__":
    run_tests()
