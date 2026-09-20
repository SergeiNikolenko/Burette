# Аудит производительности и надёжности Burette — 20 сентября 2026

База исходников: `162e3a63`, рабочая копия с ранее подготовленной версией `2026.9.1`.
Схема версии: год.месяц.номер_выпуска_в_месяце.

Проверены цепочки открытия/истории/сохранения, molecular Grid и generic CSV,
Mol* playback/редактирование, native и fallback compute, а также release/update
код. Ниже 22 конкретных находки. Это широкий аудит перечисленных поверхностей,
а не доказательство отсутствия других ошибок. Native UI, CPU/GPU/RSS профили,
реальное обновление, Quick Look, iPhone и научная точность всех методов при первоначальном
аудите не проверялись; последующие проверки перечислены ниже. Первоначальные находки ниже описывают состояние базы аудита.

## Ход исправлений

После аудита внесены исправления сохранения с подтверждением host, удержания dirty-вкладок,
разделения расчёта и открытия результата, идентичности и отмены conformer jobs,
контроля метода CPU fallback, тайм-аута Python, асинхронного чтения и бюджета текста,
совместного использования текстов в истории, кеша счётчиков Grid, потокового импорта
CSV/TSV/SMI/DWAR, индекса выделения текста, сортировки таблиц, паузы скрытого playback,
кеша разобранных поз и XYZ, обновлений оформления без повторной загрузки слоёв, фонового Align,
бюджета текстового Undo, индекса графа выравнивания и удаления лишнего PM6 dispatch.

Проверены targeted Rust tests (включая sparse CSV, DWAR footer, CSV >64 MiB,
некорректный UTF-8), TypeScript, контракты интерфейса, история, сортировка,
подтверждение Save и lifecycle conformer jobs. В browser-dev проверены настоящие
восемь поз imatinib: переходы вперёд/назад, одна активная структура в дереве и Align.
Панель молекул при переносе под верхнюю строку выровнена по левому отступу viewport.

Продолжение 21 сентября: alignment/semiempirical теперь передают ранний durable job ID
и прогресс через Tauri Channel, проверяют отмену между молекулами и перед фактическим
входом в сервис. Активный dispatch ограничен 30 секундами; UI показывает ожидание
остановки до возврата вычисления. Завершённые строки сохраняются в отдельный JSONL
до 64 MiB с методом, frozen source и runtime; для alignment сохраняются также
матрицы и выровненные SDF. Отмена не выдаёт частичный результат за полный успех.

Очередь оформления объединяет ожидающие изменения одного документа, сохраняет
загруженные слои и обновляет совместимые representations на месте. Viewer Align
использует отдельный worker с отменой и прекращением работы при смене документа
или панели управления. Повторный browser smoke: восемь поз → Aligned.

Нативная проверка отдельной сборки `e8d9-reliability`: изменение атома → Save →
Cancel сохраняет Unsaved changes; успешная запись CIF снимает dirty только после
ответа host. Тесты реального packaged Metal service подтверждают восстановление
после перезапуска и отмену alignment после двух поз из трёх: третья не считается,
JSONL содержит ровно две готовые структуры с преобразованиями. Проверка read-only
ошибки атомарной записи и реакции dirty выполнена отдельными Rust/host-contract
тестами, не единым прогоном системного диалога. TypeScript, Clippy и focused tests
для изменённых путей проходят.

Ограничения проверки: пакетное открытие с медленного тома, длительные GPU/RSS
профили, Quick Look и iPhone в этом проходе не проверялись. Кеши ограничены размером
исходного текста, это не измеренный предел RSS; Undo сохраняет хотя бы одну запись
даже сверх бюджета. Проценты ускорения не измерены. Основное установленное
приложение не заменялось; изменения подготовлены в рабочей ветке и dev-сборке.

P1 — риск потери работы, неверного метода/результата или блокировки основных
действий. P2 — существенные лишние расходы либо некорректное управление/отображение.
Критичность скорости зависит от размеров входных данных; проценты ускорения не
придуманы. Каждая запись содержит конкретный trigger, изменение и приёмку.

## 01. P1 — Сохранение Mol* преждевременно снимает dirty

**Основание:** [PreviewExtension/Web/viewer.js:5418](../PreviewExtension/Web/viewer.js) (строка 5418); [apps/desktop/src/hooks/use-app-viewer-file-actions.ts:34](../apps/desktop/src/hooks/use-app-viewer-file-actions.ts) (строка 34).

Save modified structure отправляет exportText и сразу снимает признак изменений. Host ещё только открывает системный диалог; Cancel или ошибка записи не возвращают подтверждение в iframe. Пользователь может считать изменения сохранёнными.

**Исправление:** Добавить request ID и ответ success/cancel/error. Снимать dirty лишь после успешной записи той же ревизии; редактирование во время записи не должно помечаться сохранённым.

**Приёмка:** Save → Cancel; Save → ошибка записи; Save → новое редактирование до завершения. Во всех трёх случаях актуальные несохранённые изменения остаются dirty.

**Уровень подтверждения:** Извлечённый обработчик выполнен с mock host: export-posted → dirty=false при hostAcknowledged=false. Это воспроизведение логики, не нативного диалога.

## 02. P1 — Вытеснение вкладки может уничтожить изменения структуры

**Основание:** [apps/desktop/src/components/editor-area/index.tsx:19](../apps/desktop/src/components/editor-area/index.tsx) (строка 19); [PreviewExtension/Web/viewer.js:5355](../PreviewExtension/Web/viewer.js) (строка 5355).

Warm-cache защищает только dirtyGridDocuments. Mol* destructive edits и история живут внутри iframe, setMolstarStructureDirty не сообщает dirty хосту. После посещения ещё десяти вкладок изменённый iframe может быть размонтирован и затем открыт из исходного файла.

**Исправление:** Передавать Mol* dirty/revision хосту; до вытеснения сохранять checkpoint либо удерживать изменённый документ. Согласовать это с закрытием и quit.

**Приёмка:** Удалить атом → посетить 10 других вкладок → вернуться; изменения и Undo должны сохраниться. Затем отдельно проверить закрытие/quit.

**Уровень подтверждения:** Настоящая warmMountedTabs в изолированном запуске исключила первую из 11 вкладок без записи в dirtyGridDocuments. Полный native сценарий ещё нужен.

## 03. P1 — CPU fallback меняет выбранный научный метод

**Основание:** [apps/desktop/src/hooks/use-app-grid-conformer-messages.ts:384](../apps/desktop/src/hooks/use-app-grid-conformer-messages.ts) (строка 384); [scripts/rdkit_conformer.py:153](../scripts/rdkit_conformer.py) (строка 153).

Native путь получает conformerVariant и mmffVariant; запасной передаёт лишь engine/candidateCount/rmsdCutoff. Python использует ETKDGv3 и MMFF94s либо UFF. Запрос DG + MMFF94 после ошибки native может дать результат другого метода.

**Исправление:** Сохранять requested/effective method и передавать поддерживаемые параметры через fallback. Неподдерживаемый метод должен давать явное объяснение, а не молчаливую замену.

**Приёмка:** Принудительная ошибка native при DG/MMFF94: проверить запрос CPU, итоговый метод и provenance.

**Уровень подтверждения:** Прослежены caller, conformer-generation.ts:133 и Python embed_params:180. Научный workload не запускался.

## 04. P1 — Ошибка открытия результата запускает расчёт заново

**Основание:** [apps/desktop/src/hooks/use-app-grid-conformer-messages.ts:325](../apps/desktop/src/hooks/use-app-grid-conformer-messages.ts) (строка 325); [apps/desktop/src/hooks/use-app-grid-conformer-messages.ts:350](../apps/desktop/src/hooks/use-app-grid-conformer-messages.ts) (строка 350).

Генерация, публикация и await openDocuments находятся в одном try. Ошибка открытия уже готового файла попадает в catch «Metal generation failed», после чего запускается CPU-расчёт всей выборки. Это расход времени и возможный другой результат.

**Исправление:** Разделить расчёт, публикацию и отображение. Для готового артефакта предлагать повтор открытия; fallback разрешать только для подходящих вычислительных ошибок.

**Приёмка:** Успешный workflow + rejected openDocuments: ноль CPU retries, сохранённый путь результата и отдельная ошибка открытия.

**Уровень подтверждения:** Подтверждено по цепочке управления; ошибка открытия в установленном приложении не воспроизводилась.

## 05. P1 — Запасная генерация 3D блокирует обработчик native-команды

**Основание:** [apps/desktop/src-tauri/src/commands/documents.rs:1140](../apps/desktop/src-tauri/src/commands/documents.rs) (строка 1140); [apps/desktop/src-tauri/src/commands/documents.rs:1242](../apps/desktop/src-tauri/src/commands/documents.rs) (строка 1242).

Синхронная Tauri-команда запускает Python и ждёт wait_with_output без deadline. В fallback это повторяется последовательно для каждой молекулы. Дорогой или зависший процесс удерживает обработчик; локальный tauri-macros не переносит sync body в worker.

**Исправление:** Асинхронный контракт с blocking worker, ограничение времени и остановка дочернего процесса. После исправления управления рассмотреть переиспользование Python worker вместо старта на каждую строку.

**Приёмка:** Медленный/зависший тестовый worker: интерфейс отзывчив, deadline завершает задачу, Cancel останавливает дочерний процесс.

**Уровень подтверждения:** По исходникам команды, caller и локального macro wrapper; нативный hang не запускался.

## 06. P1 — История навигации копирует содержимое всех открытых документов

**Основание:** [apps/desktop/src/stores/molecule-store.ts:421](../apps/desktop/src/stores/molecule-store.ts) (строка 421); [apps/desktop/src/stores/workspace-history-store.ts:159](../apps/desktop/src/stores/workspace-history-store.ts) (строка 159).

Select tab и ряд действий sidebar/dock/settings создают before/after snapshots, включающие весь textDocuments.content. JSON-clone и сравнение снова сериализуют эти данные. История хранит до 100 пар; закрытый документ может удерживаться ей.

**Исправление:** Вынести неизменяемое содержимое в хранилище по document/revision, в истории держать ссылки и дельты. Добавить бюджет объёма, не только числа записей.

**Приёмка:** 100 переключений с крупными текстами/изображениями; измерить main-thread time, удержание после закрытия и корректность Undo.

**Уровень подтверждения:** Source-extracted cloneJson/snapshotEquals: один переход с 1/4/12 MiB текста вызывает 4 JSON.stringify, обрабатывая примерно 4/16/48 MiB текста. Нельзя из этого заключать 200-кратный физический расход RAM.

## 07. P1 — Открытие текстов и изображений выполняет синхронный I/O

**Основание:** [apps/desktop/src-tauri/src/commands/text_files.rs:90](../apps/desktop/src-tauri/src/commands/text_files.rs) (строка 90); [apps/desktop/src-tauri/src/commands/text_files.rs:98](../apps/desktop/src-tauri/src/commands/text_files.rs) (строка 98).

read_text_file/open_text_files синхронны: canonicalize, чтение, декомпрессия и base64 выполняются последовательно. Особенно заметный риск у больших maegz и медленного тома. Есть лимит 12 MiB на текст, но общего текстового batch-бюджета нет; image batch-бюджет уже есть.

**Исправление:** По образцу read_document_file вынести работу в worker, ограничить суммарный объём, выдавать результаты поэтапно и отменять устаревшие открытия. Сохранить provisional claims/revision guards.

**Приёмка:** Пакет больших файлов с медленного тома → отмена/закрытие во время чтения: окно отвечает, поздние вкладки не появляются.

**Уровень подтверждения:** По исходникам. Время реального I/O зависит от тома и требует native проверки.

## 08. P2 — Длительными расчётами нельзя полноценно управлять

**Основание:** [apps/desktop/src/lib/standalone-compute.ts:91](../apps/desktop/src/lib/standalone-compute.ts) (строка 91); [apps/desktop/src-tauri/src/compute/semiempirical_workflow.rs:208](../apps/desktop/src-tauri/src/compute/semiempirical_workflow.rs) (строка 208).

Conformer jobs объявлены cancelable:false. Semiempirical обходит до 256 молекул без hook отмены/прогресса между строками. Durable jobs существуют, но standalone alignment/semiempirical возвращают финальный результат вместо немедленного доступного ID; изменение durable state само не прерывает текущий service dispatch.

**Исправление:** Выдавать job ID при submission, связать UI с существующей durable job, добавить cancellation token на границах молекул/пакетов и ограничить время активного dispatch.

**Приёмка:** Cancel после первой молекулы: последующие не считаются, успешные промежуточные результаты доступны, вычисление действительно останавливается в установленный срок.

**Уровень подтверждения:** По UI, workflow и coordinator.rs:2901. Это пробел управления, а не отсутствие backend-хранилища задач.

## 09. P2 — UI обещает запись semiempirical-результатов в Grid, когда она не состоялась

**Основание:** [apps/desktop/src/hooks/use-app-grid-conformer-messages.ts:156](../apps/desktop/src/hooks/use-app-grid-conformer-messages.ts) (строка 156); [apps/desktop/src-tauri/src/compute/coordinator.rs:688](../apps/desktop/src-tauri/src/compute/coordinator.rs) (строка 688).

Backend может сохранить расчёт, но вернуть gridApplied=false/gridWarning, например для устаревшего или изменённого источника. UI игнорирует это и сообщает results were written to Grid; отсутствие сходимостных ошибок даёт success.

**Исправление:** Отдельно показывать вычислительный успех и применение к таблице; выводить gridWarning и безопасный путь открытия/повторного применения результата.

**Приёмка:** Converged rows + gridApplied=false: результат доступен, но нет ложного сообщения о заполненной таблице.

**Уровень подтверждения:** Прослежены возвращаемый payload и обработчик.

## 10. P2 — Один расчёт создаёт две задачи и неверно обозначает backend

**Основание:** [apps/desktop/src/hooks/use-app-grid-conformer-messages.ts:275](../apps/desktop/src/hooks/use-app-grid-conformer-messages.ts) (строка 275); [apps/desktop/src/lib/standalone-compute.ts:81](../apps/desktop/src/lib/standalone-compute.ts) (строка 81).

Grid создаёт свою строку, затем standalone создаёт второй UUID и публикует вторую задачу в общий список. Для одной молекулы/конформера standalone выбирает referenceCpu, но внешняя задача жёстко сообщает nativeMetal и via Metal GPU.

**Исправление:** Один владелец задачи/ID; фактический backend брать из результата и этапов durable job.

**Приёмка:** Одна строка Grid → одна задача; backend совпадает с выполненным workflow.

**Уровень подтверждения:** Прослежены standalone publish и подписка use-app-chemistry-jobs.ts:54.

## 11. P2 — Каждая страница отфильтрованной таблицы снова подсчитывает все совпадения

**Основание:** [apps/desktop/src-tauri/src/preview/grid_store.rs:914](../apps/desktop/src-tauri/src/preview/grid_store.rs) (строка 914); [apps/desktop/src-tauri/src/preview/grid_store.rs:973](../apps/desktop/src-tauri/src/preview/grid_store.rs) (строка 973).

Page fetch сначала выполняет exact count с substring LIKE, затем count для проверки покрытия FTS, затем page SELECT. При том же фильтре и данных следующие страницы повторяют эту работу. FTS не устраняет первый полный substring scan.

**Исправление:** Кешировать count и применимость FTS по фильтру/ревизии данных, корректно инвалидировать при ingest/edit. Сохранить substring-семантику поиска.

**Приёмка:** Большая коллекция: первая и следующие 20 страниц одного фильтра, число запросов и query plan; затем изменение данных и проверка актуальности count.

**Уровень подтверждения:** Повторные запросы подтверждены по исходникам; ускорение не измерено.

## 12. P2 — Большие CSV/TSV/SMI/DWAR сначала читаются целиком

**Основание:** [apps/desktop/src-tauri/src/preview/runtime.rs:740](../apps/desktop/src-tauri/src/preview/runtime.rs) (строка 740); [apps/desktop/src-tauri/src/preview/grid_store.rs:711](../apps/desktop/src-tauri/src/preview/grid_store.rs) (строка 711).

File-backed ingestion допускает SDF/SD. Остальные перечисленные форматы идут через полное чтение bytes и decode_text в String, который удерживается ingest worker. Время до первой страницы и пик памяти зависят от всего файла.

**Исправление:** Расширить file-backed reader, сохранив parser state для multiline CSV и DWAR metadata. Ограничить байты записи и пакета.

**Приёмка:** Одинаковые крупные коллекции разных форматов: первая страница, peak RSS, порядок/число записей, отмена и изменение исходника.

**Уровень подтверждения:** По ветвлению runtime/grid_store. Уже исправленный квадратичный batch parsing сюда не включён.

## 13. P2 — Выделение одной строки повторно обходит весь структурный текст

**Основание:** [apps/desktop/src/lib/text-structure-selection.ts:60](../apps/desktop/src/lib/text-structure-selection.ts) (строка 60); [apps/desktop/src/components/text-file-viewer.tsx:172](../apps/desktop/src/components/text-file-viewer.tsx) (строка 172).

selectedTextLines делает split всего документа и обход всех строк даже при выделении первой. Во время drag это повторяется; 120 ms debounce применяется уже после вычисления selector. Indexed atom path может повторно разбивать текст.

**Исправление:** Использовать CodeMirror ranges/line offsets; debounce до вычисления, кешировать индексы по revision и не запускать структурный разбор для нерелевантных форматов.

**Приёмка:** Drag по крупному PDB: правильный selector без полного обхода файла на каждом pointermove.

**Уровень подтверждения:** Извлечённая функция на 11.3 MiB/150000 строк посетила 150001 строку ради результата из одной строки. Это алгоритмический тест, не native latency.

## 14. P2 — Сортировка обычного CSV каждый раз копирует всю таблицу в новый worker

**Основание:** [apps/desktop/src/components/ui/csv-viewer-sort-worker.ts:41](../apps/desktop/src/components/ui/csv-viewer-sort-worker.ts) (строка 41); [apps/desktop/src/components/ui/csv-viewer-grid.tsx:454](../apps/desktop/src/components/ui/csv-viewer-grid.tsx) (строка 454).

Generic CSV viewer materializeRows, создаёт worker и отправляет все ячейки, хотя сортируется один столбец; после ответа worker уничтожается. При ошибке вызывается синхронная сортировка на главном потоке. Это отдельная поверхность от molecular SQLite Grid.

**Исправление:** Передавать ключи одного столбца и индексы, переиспользовать worker/cache по revision; возвращать индексный buffer. Не заменять ошибку worker неограниченной main-thread работой.

**Приёмка:** Широкая CSV, 10 смен сортировки: объём пересылки, память, long tasks; устаревшие результаты не применяются, ties стабильны.

**Уровень подтверждения:** Проверены worker и fallback call site: csv-viewer-grid.tsx:483.

## 15. P2 — Playback скрытой вкладки продолжает менять модели

**Основание:** [PreviewExtension/Web/viewer.js:18724](../PreviewExtension/Web/viewer.js) (строка 18724); [PreviewExtension/Web/viewer.js:2818](../PreviewExtension/Web/viewer.js) (строка 2818).

Host отправляет viewerVisibilityChanged, но флаг блокирует resize, не setTimeout → setPose loop. Warm-mounted скрытая вкладка продолжает model transactions и сообщения; несколько таких вкладок конкурируют за ресурсы.

**Исправление:** Приостанавливать scheduler при скрытии, сохранять намерение playback и определённую политику playhead при возвращении.

**Приёмка:** Счётчик pose transactions/CPU при активной и скрытой вкладке; возвращение не теряет выбранный кадр.

**Уровень подтверждения:** Цикл подтверждён по коду. Постоянную GPU-отрисовку скрытой вкладки не утверждаем без замера.

## 16. P2 — Каждый шаг SDF/docking заново строит активную молекулу

**Основание:** [PreviewExtension/Web/viewer.js:14513](../PreviewExtension/Web/viewer.js) (строка 14513); [PreviewExtension/Web/viewer.js:14618](../PreviewExtension/Web/viewer.js) (строка 14618).

Prev/Next/slider/Loop удаляют активные structure refs, заново разбирают текст и создают representations. Фоновая сцена уже сохраняется; проблема относится к активному слою.

**Исправление:** Для общей topology обновлять координаты/model; для разных молекул использовать небольшой ограниченный кеш соседних подготовленных поз.

**Приёмка:** 100 шагов: parse/build count, задержка pose и camera drag, peak RSS.

**Уровень подтверждения:** Повторная работа подтверждена; выигрыш требует профиля, универсальное хранение всех моделей не предлагается.

## 17. P2 — XYZ overlay декодирует весь источник повторно и сбрасывает frame-cache

**Основание:** [PreviewExtension/Web/viewer.js:14642](../PreviewExtension/Web/viewer.js) (строка 14642); [PreviewExtension/Web/viewer.js:14660](../PreviewExtension/Web/viewer.js) (строка 14660).

rawStructureData вызывается до проверки frame-cache. В single fallback сбрасывается overlay state и очищается plugin, поэтому следующий кадр может снова splitXyzFrames всего источника. Native trajectory route нужно оценивать отдельно.

**Исправление:** Кеш decoded/parsed source по revision независимо от режима показа; обновление кадра без уничтожения источника и plugin.

**Приёмка:** После первого чтения 100 смен кадров без повторного полного decode/parse; отдельно проверить обычный trajectory route.

**Уровень подтверждения:** Проверены rawStructureData:10740 и overlay path. Проблема не объявляется общей для всех XYZ-режимов.

## 18. P2 — Цвет и прозрачность запускают пересборку геометрии

**Основание:** [PreviewExtension/Web/viewer.js:14472](../PreviewExtension/Web/viewer.js) (строка 14472); [PreviewExtension/Web/viewer.js:14235](../PreviewExtension/Web/viewer.js) (строка 14235).

В All mode context opacity/color входят в cache key. Его изменение вызывает plugin.clear и загрузку структуры. Очередь сериализует rebuilds, но не объединяет устаревшие appearance updates.

**Исправление:** Разделить geometry и appearance; менять параметры representations на месте, применять последнее ожидающее значение.

**Приёмка:** Поменять только цвет/opacity: parseTrajectory и число structure nodes не изменяются; серия изменений не образует очередь ненужных загрузок.

**Уровень подтверждения:** Аналогичные ветки проверены для XYZ/docking; величина задержки не измерена.

## 19. P2 — Viewer Align выполняет большую работу синхронно в UI

**Основание:** [PreviewExtension/Web/viewer.js:18883](../PreviewExtension/Web/viewer.js) (строка 18883); [PreviewExtension/Web/viewer.js:18920](../PreviewExtension/Web/viewer.js) (строка 18920).

Для XYZ/SDF ensemble контролы вычисляют sample alignment gain, а Align проходит кадры/атомы и строит текстовые представления без yield/cancellation. Изменение disabled-кнопки не даёт браузеру отрисоваться до конца синхронного участка.

**Исправление:** Вынести alignment в worker/существующий compute runtime, лениво проверять совместимость, переиспользовать разобранные кадры; дать progress/cancel.

**Приёмка:** Длинный ensemble: long tasks, responsive camera и cancellation; неизменность геометрического результата.

**Уровень подтверждения:** По execution path. Размер ансамбля, при котором это заметно на данном Mac, ещё не измерен.

## 20. P2 — Undo структурных изменений ограничен записями, но не байтами

**Основание:** [PreviewExtension/Web/viewer.js:21954](../PreviewExtension/Web/viewer.js) (строка 21954); [PreviewExtension/Web/viewer.js:21993](../PreviewExtension/Web/viewer.js) (строка 21993).

Destructive edit сохраняет полный экспорт структуры; стек обрезается после 20 записей. Крупные структуры удерживают много текстовых данных и создают временные allocations. Лёгкие scene snapshots уже существуют и сюда не относятся.

**Исправление:** Бюджет байтов для undo/redo; structural deltas либо disk checkpoints для крупных правок, сохраняя корректное восстановление.

**Приёмка:** 20 изменений крупной структуры, Undo/Redo и закрытие: peak/retained memory, корректность результата.

**Уровень подтверждения:** Подтверждён формат snapshots. Оценка 20×размер экспорта — объём содержимого, не измерение фактического RSS.

## 21. P2 — Native alignment многократно пересчитывает одинаковые графовые признаки

**Основание:** [apps/desktop/src-tauri/src/compute/alignment_workflow.rs:398](../apps/desktop/src-tauri/src/compute/alignment_workflow.rs) (строка 398); [apps/desktop/src-tauri/src/compute/alignment_workflow.rs:487](../apps/desktop/src-tauri/src/compute/alignment_workflow.rs) (строка 487).

Для каждого probe atom заново вычисляются signatures всех reference atoms; signature сканирует атомы и сортирует соседей. Подготовка имеет кубический компонент, использует плотные N×N матрицы и повторяет reference preparation для каждой позы.

**Исправление:** Кешировать signatures/граф эталона, индексировать кандидатов по signature, рассмотреть sparse adjacency. Ограничить поиск на симметричных графах без изменения научного контракта.

**Приёмка:** Раздельно измерить preparation и GPU для разных atom/pose counts; mappings и scores должны совпадать.

**Уровень подтверждения:** Повторная работа подтверждена. Не утверждаем, что она доминирует на маленьких лигандах.

## 22. P2 — PM6-D3H4 повторно считает GPU-поправку и не использует её энергию

**Основание:** [apps/desktop/src-tauri/src/compute/semiempirical_workflow.rs:473](../apps/desktop/src-tauri/src/compute/semiempirical_workflow.rs) (строка 473); [crates/burette-compute-core/src/semiempirical/pm6_scf.rs:565](../crates/burette-compute-core/src/semiempirical/pm6_scf.rs) (строка 565).

CPU evaluator уже добавляет D3/H4/HH correction в энергию. Затем workflow вызывает Metal correction и берёт лишь gpu_time_ms — полученные энергии не используются и не сравниваются. Это лишний dispatch в production-пути.

**Исправление:** Либо использовать GPU correction с проверкой точности, либо оставить повтор только явным validation-режимом. Не удалять научную поправку из результата.

**Приёмка:** Счётчик dispatches и сравнение энергий до/после: одна необходимая correction computation в production.

**Уровень подтверждения:** Прослежены CPU total energy и использование Metal результата; scientific benchmark не запускался.

## Что исправлено в предыдущей оценке

- «Все конформеры провалились, но результат recovered» исключено: backend
  `compute/conformer_reference_validator.rs:47` отклоняет passed_count == 0.
- У alignment/semiempirical уже есть durable jobs и артефакты. Проблема —
  согласованность их живого отображения и управления, не отсутствие хранения.
- Старый аудит от 5 сентября помечен исправленным; его ошибки не перенесены.
- Уже есть warm LRU, dirty-grid pinning, подавление скрытого resize,
  coalescing slider input, ограниченное XYZ background sampling, кеш ресурсов,
  потоковый SDF и лёгкие scene undo snapshots. Их не нужно «добавлять заново».
- Finder, shortcuts, Quick Look и нативные меню не представлены как новые фичи.

## Порядок внедрения

1. Защитить изменения структуры: **01–02**. Освобождать память до исправления
   dirty-контракта опасно.
2. Сохранить смысл и достоверность вычислений: **03–05, 09–10**. Повторять
   открытие результата отдельно от пересчёта.
3. Убрать main-thread работу на частых действиях: **06–07, 13–14**.
4. Управление задачами и фоновая нагрузка: **08, 15**.
5. Большие таблицы и последовательности поз: **11–12, 16–20**.
6. Профиль и точечная оптимизация научной подготовки: **21–22** с обязательной
   проверкой эквивалентности результатов.

Каждый этап — отдельная проверяемая правка; не объединять это в переписывание
центрального viewer.js или общего orchestration. В первую очередь измерять
пользовательскую операцию целиком, затем её parse, preparation, compute и
render части. Общий FPS или метка Metal сами по себе проблему не объясняют.

## Дополнительные release-наблюдения, ниже основного списка

- `.github/workflows/release.yml:94` разрешает ad-hoc публикацию при отсутствии
  signing/notarization credentials. Это условный риск release pipeline, не
  утверждение, что текущий установленный релиз неподписан.
- `scripts/sparkle-appcast.py:27` формирует title/link/enclosure, но не
  releaseNotesLink/description: ссылка на GitHub существует, встроенный текст
  изменений не передаётся этим генератором. Улучшение вторично относительно
  потери работы и повторных вычислений.

## Нумерация установленного приложения OpenAI

Прочитан локальный `/Applications/ChatGPT.app/Contents/Info.plist`:
CFBundleShortVersionString = **26.915.31945**, CFBundleVersion = **9922**.
Процессы Codex запущены из этого приложения. Номер не совпадает буквально со
схемой Burette **2026.9.1**. Официальная расшифровка компонентов 915/31945 в
этом аудите не установлена; нельзя уверенно называть последний компонент
номером выпуска внутри месяца.

