# Burette — demo storyboard (candidate, not yet recorded)

## Идея

Не «посмотрите, кнопки работают», а две законченные задачи:
**найти лиганд в экспериментальном комплексе** и **проверить/изменить химические
структуры, полученные от коллеги**. Аудитория — исследователь, преподаватель,
студент, работающий со структурными данными. Никаких обещаний drug discovery
«одной кнопкой», docking или предсказания активности.

## Основное видео: около 2 минут 40 секунд

Это рекомендуемая длительность, не требование OpenAI. Запись реального ChatGPT
с актуальным подключением. Для заявки тесты выполняются независимо; в видео
переход между главами допускается явно обозначенным монтажом. Можно сократить
ожидание, но нельзя скрывать ошибку или монтировать другой результат вместо неё.

| Время | Сцена и действие пользователя | Английская озвучка / титр |
|---|---|---|
| 0:00–0:10 | ChatGPT, краткий титр Burette; затем реальный запрос | **“From a molecular file or a PDB identifier to a structure you can actually explore—without leaving ChatGPT.”** |
| 0:10–0:40 | P1: открыть 1STP; показать различие protein/ligand/water; повернуть структуру | “First, inspect an experimental streptavidin–biotin complex. Burette separates the protein, bound ligand, and solvent in its summary.” |
| 0:40–1:05 | P2: до/после; выбрать BTN A300, сфокусировать, скрыть воду, оставить белок | “Find the bound biotin, focus on it, and remove solvent from the view while keeping the protein as context.” |
| 1:05–1:40 | Новая глава; прикрепить реальный salicylate-series.sdf; показать все 3 записи | “Next, inspect a colleague’s structure handoff. Check all three records and their names before using the file.” |
| 1:40–2:25 | P5, включает P4-подобный старт: salicylic acid → aspirin → read/export | “Create an editable reference sketch, replace it with aspirin, then read back the final SMILES. The exported structure and the visible drawing must agree.” |
| 2:25–2:40 | Непустая финальная карточка и экспорт рядом; краткий титр | **“Inspect structures. Edit sketches. Check the result. Burette, inside ChatGPT.”** |

## Запросы для записи

Использовать дословные P1, P2, P3 и P5 из `review-cases.md`. Не добавлять в запрос
«сделай красиво», раскраску конкретных остатков, водородные связи или автоматический
поиск кармана: это не часть проверенного публичного набора действий.

## Что должно быть видно

- Название плагина, пользовательский запрос, настоящий инструмент и результат.
- В P1: белок и ligand, а не только числовой ответ.
- В P2: сравнение камеры до/после; воды действительно скрыты. Если любой эффект
  не доказан — это незакрытый тест, а не повод продолжать озвучку как при успехе.
- В P3: три различимые структуры, а не одна картинка с заявлением «три молекулы».
  Атомы считаем **записанные в файле**; implicit H не называем отсутствующими в химии.
- В P5: стартовая структура, новая структура и её экспорт. Не выдавать
  переключение 2D→Mol* за генерацию/оптимизацию 3D-конформера.
- Никаких приватных файлов, токенов, системных путей пользователя и других чатов.

## Отдельный мобильный клип: 30–45 секунд

Записать на физическом телефоне, если мобильная поверхность заявляется:
открыть 1STP, жестами повернуть/приблизить, открыть controls, проверить читаемость
и отсутствие обрезанных элементов. При возможности кратко показать Ketcher.
Desktop viewport шириной390px не называть проверкой iPhone. Это дополнение,
а не замена независимому прогону submitted cases на mobile.

## Честное позиционирование

**Short description:** “Explore molecular structures”

**One-line pitch:**
“Burette turns molecular files, PDB entries, and chemical sketches into an
interactive workspace inside ChatGPT.”

**Boundary note:**
“Burette supports molecular inspection and transient sketch editing. It does
not run docking, predict binding affinity, or overwrite your source files.”

Сейчас это сценарий записи. Видео, mobile PASS и готовность всей заявки ещё
не подтверждены. В текущей официальной инструкции видео не указано как
обязательный материал; проверять дополнительные требования конкретной заявки.
