# Пользовательские сценарии нативного GPU Compute Layer

Этот документ описывает пользовательские сценарии MolComputeKit в Burrete,
предусловия каждой операции, результат, поведение при ошибке и границы между
режимами приложения. Цель контракта — одинаковая химическая логика и честная
информация о backend на каждом поддерживаемом слое.

## Общая точка входа

1. Откройте в Burrete молекулярную коллекцию SDF, SMI/SMILES, CSV или TSV.
2. Выберите молекулы в карточках или таблице Grid. Перед выбором можно применить
   поиск и фильтры.
3. Проверьте индикатор вычислений справа сверху:
   - `Metal ready` означает, что packaged helper и Metal library проверены и
     доступен указанный Apple GPU;
   - CPU/fallback означает реальное выполнение reference backend;
   - `Desktop compute unavailable` означает, что текущий режим не имеет права
     запускать нативные вычисления.
4. Запустите операцию из панели Grid.
5. Численные результаты возвращаются в Grid, структуры открываются в Mol*, а
   отчёт и provenance сохраняются как неизменяемые артефакты задания.

Первая выбранная строка имеет особое значение только для alignment: строка с
наименьшим стабильным source index становится reference pose. В остальных
операциях source order используется для устойчивой идентичности и разрешения
равных результатов, а не как химический параметр.

## Матрица режимов

| Режим | Просмотр | Нативные compute-действия | Требуемое поведение |
| --- | --- | --- | --- |
| Установленное macOS desktop-приложение, Grid bridge | да | полный набор | Проверить helper, metallib и устройство; показывать `Metal ready` только после attestation |
| Browser-dev / browser preview | да | нет | Показывать `Desktop compute unavailable`; не отправлять фиктивные GPU-задания |
| Finder Quick Look | только чтение | нет | Не показывать активные compute-кнопки и не изменять исходный файл |
| iPhone source app | просмотр поддерживаемых форматов | нет macOS Metal runtime | Не заявлять поддержку desktop compute и не имитировать fallback |
| Agent/plugin | чтение и управление опубликованными структурами/отчётами | публичного compute action пока нет | Использовать те же bounded artifacts; не обходить Grid/job contracts скрытым вызовом |

Полная химическая функция считается доступной пользователю только в
установленном desktop-приложении. Остальные режимы обязаны корректно объяснять
границу возможностей, а не показывать кнопку, которая завершится неизвестной
ошибкой или ложным сообщением о GPU.

## Матрица слоёв

Каждая операция проходит одну и ту же проверяемую цепочку:

1. **Grid UI** определяет доступность кнопки из текущего выбора, наличия
   координат и capability state.
2. **Grid viewer** переводит выбранные строки в стабильные source indexes и
   отправляет типизированное сообщение в host.
3. **Tauri bridge** проверяет форму запроса и не принимает неподдерживаемую
   комбинацию режима, метода или scope.
4. **Coordinator** замораживает molecular snapshot и создаёт durable job с
   последовательными стадиями.
5. **Memory planner** учитывает EnginePack, сохраняемый результат, reference
   coordinates и временные Metal buffers до dispatch.
6. **Attested compute helper** выполняет разрешённые kernels из pinned runtime;
   production UI не вызывает Python/MLX.
7. **Metal / reference CPU** выполняют независимые численные части. Backend,
   device, kernel, время GPU и fallback записываются на уровне стадии.
8. **Validation** сравнивает один и тот же физический объект: например, ETK
   energy проверяется на pre-MMFF координатах, а не на уже изменённой MMFF
   геометрии.
9. **Publication** атомарно создаёт manifest, бинарные массивы, структуры и
   report; незавершённый staging-каталог не считается результатом.
10. **Writeback** связывает analysis values со stable molecule identity, после
    чего Grid заново запрашивает страницы и показывает новые колонки.
11. **Mol*** открывает опубликованную структуру или ансамбль; успешный backend
    без видимого результата не считается завершённым пользовательским сценарием.

## Матрица входов и действий

| Действие | Минимальный вход | Требование координат | Основной результат |
| --- | --- | --- | --- |
| Кластеризация | выбранные, отфильтрованные или все строки | нет | cluster и representative columns в Grid |
| Поиск похожих | ровно одна строка и успешный cluster run | нет | top-50 Tanimoto в Grid |
| Экспорт разнообразия | успешный cluster run | нет | структуры, CSV и provenance bundle |
| Генерация 3D | одна или несколько строк со SMILES/molfile | нет | ранжированный ансамбль в Mol* и Grid |
| Оптимизация геометрии | один или несколько molfile records | явные координаты у каждой строки | оптимизированные структуры и MMFF columns |
| Энергии и заряды | от 1 до 256 molfile records | явные координаты у каждой строки | method-specific energies, charges и report |
| Alignment и scoring | от 2 до 256 совместимых poses | явные координаты у каждой строки | aligned SDF, RMSD, shape и ESP scores |

Отключённая кнопка — результат preflight, а не визуальная случайность. SMILES
можно передать в `Generate 3D`, но нельзя оптимизировать, выравнивать или
оценивать semi-empirical методом до появления явных координат.

## US-1. Кластеризация молекулярной библиотеки

**Как пользователь**, я хочу сгруппировать библиотеку по fingerprint similarity,
чтобы увидеть химические серии без построения плотной матрицы `N × N`.

**Где:** Grid → `Similarity` → `Cluster selected`, `Cluster filtered` или
`Cluster all`.

**Как выполнить:**

1. Выберите строки. Если выбора нет, scope задаёт активный фильтр; если нет и
   фильтра, используется вся коллекция.
2. Выберите Tanimoto cutoff. `0.70` — общий default, более высокое значение
   формирует более узкие серии.
3. Нажмите `Cluster ...`. Повторное нажатие запрашивает cancellation на текущей
   durable stage boundary.
4. Проверьте колонки Cluster ID, Representative, status и error.

**Результат:** fingerprints упаковываются один раз; Metal строит blockwise
Tanimoto neighbours и CSR без матрицы `N × N`; deterministic CPU Butina
назначает кластеры. Snapshot привязан к точным row identities. Планировщик
поддерживает класс библиотек 100k+ в пределах проверенного memory plan.

**Ошибки:** невалидная молекула получает row-level status. Недоступный Metal
отражается как явный reference CPU fallback только когда политика это разрешает.

## US-2. Поиск аналогов одной молекулы

**Как medicinal chemist**, я хочу выбрать query molecule и найти ближайшие
аналоги в той же библиотеке.

**Где:** Grid → `Find similar`.

**Как выполнить:**

1. Выполните clustering нужного snapshot.
2. Выберите ровно одну query molecule из этого snapshot.
3. Нажмите `Find similar`.
4. Сортируйте или фильтруйте результат по rank или similarity.

**Результат:** Burrete повторно использует проверенные packed fingerprints,
исключает query из выдачи и возвращает точный top-50 Tanimoto. При равенстве
score порядок определяется stable source identity.

**Ошибки:** кнопка отключена, если нет подходящего cluster snapshot или выбрано
не ровно одно соединение.

## US-3. Выбор разнообразных представителей

**Как screening scientist**, я хочу получить одного детерминированного
представителя каждого кластера и сократить библиотеку без потери серий.

**Где:** Grid → `Export diverse` после clustering.

**Как выполнить:**

1. Кластеризуйте нужный scope.
2. Нажмите `Export diverse` и выберите каталог.
3. Используйте структуры и CSV вместе с report, где записаны snapshot, cutoff,
   runtime и representative decisions.

**Результат:** экспорт читается из immutable cluster artifact и не зависит от
текущей сортировки карточек.

## US-4. Генерация и ранжирование 3D-конформеров

**Как molecular modeller**, я хочу получить ансамбль 3D conformers из выбранных
2D-молекул для дальнейшего scoring, docking и визуального анализа.

**Где:** Grid → conformer preset → MMFF selector → `Generate 3D`.

**Как выполнить:**

1. Выберите строки с валидным SMILES или molfile.
2. Выберите DG, KDG, ETDG, ETDGv2, ETKDG, ETKDGv2, ETKDGv3 или srETKDGv3.
   Общий default — ETKDGv3; srETKDGv3 предназначен для small rings.
3. Выберите MMFF94 или MMFF94s.
4. Нажмите `Generate 3D` и дождитесь Mol* tab.
5. Проверьте convergence, stereo status, retry count, energy и seed в Grid/report.

**Результат:** нагрузка `N molecules × K conformers` делится adaptive planner с
учётом unified memory. DG, ETK refinement, stereo validation и MMFF — отдельные
durable stages. Успешные структуры ранжируются по выбранной MMFF energy.

**Ошибки:** не прошедшие структуры сохраняются как явные statuses. CPU parity
сравнивает ETK output до MMFF с теми же pre-MMFF coordinates; допуск не
расширяется для сокрытия несовпадения.

## US-5. Оптимизация существующей геометрии

**Как computational chemist**, я хочу минимизировать переданные координаты без
повторного embedding и сохранить исходную pose как starting point.

**Где:** Grid → MMFF selector → `Optimize geometry`.

**Как выполнить:**

1. Откройте SDF с явными V2000/V3000 coordinates.
2. Выберите строки и MMFF94 или MMFF94s.
3. Нажмите `Optimize geometry`.
4. Сравните исходную и оптимизированную геометрию в Mol*; проверьте energy и
   convergence columns.

**Результат:** Burrete не генерирует заменяющий conformer. Для молекул до 32
атомов выбирается BFGS, для более крупных — L-BFGS. Неконвергировавшие случаи
получают ограниченный retry и остаются видимыми, если retry не помог.

## US-6. Приближённые энергии и атомные заряды

**Как molecular modeller**, я хочу быстро рассчитать electronic energies и
atomic charges для ranking и electrostatic scoring.

**Где:** Grid → semi-empirical selector → `<method> energy & charges`.

**Как выполнить:**

1. Выберите 1–256 records с явными координатами.
2. Выберите RM1, AM1, PM3, PM6, PM6_D, PM6_D3H4, PM6_SP или AM1*.
3. Запустите расчёт.
4. Проверьте колонки status, electronic/nuclear/total energy, SCF iterations и
   atomic charges. Сравнивайте relative conformer energies только внутри одного
   метода и совместимого состава.

**Результат:** SCF использует DIIS и adaptive damping; поддерживаемые integrals,
rotations, matrix operations и corrections выполняются на Metal и проверяются
reference CPU. PM6_D3H4 включает D3, H4 и HH repulsion. Grid pagination читает
последний `semiempirical.v1` run и показывает method-specific columns.

**Ошибки:** unsupported element или non-convergence — row-level failure, а не
выдуманное значение. `nativeMetalScfHybrid` записывается только после реального
GPU dispatch; иначе provenance явно называет CPU backend и причину fallback.

## US-7. Alignment и сравнение conformers/docking poses

**Как docking scientist**, я хочу выровнять poses по одному reference и
сравнить RMSD, shape и electrostatics.

**Где:** Grid → `Align & compare`.

**Как выполнить:**

1. Откройте SDF ensemble и выберите 2–256 coordinate-bearing poses. Reference —
   строка с наименьшим source index.
2. Для electrostatic similarity сначала рассчитайте один общий charge method у
   всех выбранных poses.
3. Нажмите `Align & compare`.
4. Проверьте aligned SDF в Mol*, а в Grid — Aligned RMSD, Shape Tanimoto,
   Electrostatic Carbo и Combined pose similarity.

**Результат:** различный atom order допускается только при точном совпадении
элементов, formal charges, bond orders и adjacency. Alignment и scoring идут
batched на Metal; последний `alignment.v1` run возвращается через Grid pages.

**Ошибки:** разные molecular graphs отклоняются. Если нет полного общего charge
run, используются formal molfile charges; all-zero charges дают unavailable ESP,
а не ложный ноль или perfect score.

## Универсальный execution contract

- Selection замораживается в immutable molecular snapshot до расчёта.
- Writeback принадлежит stable molecule identity, а не видимой позиции строки.
- Память допускается до dispatch и учитывает retained results и scratch buffers.
- Metal используется максимально для поддерживаемых numerical stages.
- `gpuRequired` завершается ошибкой, если GPU недоступен; `gpuPreferred` может
  перейти на CPU только с явным fallback reason.
- CPU implementation остаётся независимым oracle, а не production-зависимостью
  Python/MLX.
- Job, stage, backend, device, kernel, convergence, fallback и artifacts
  сохраняются и доступны для проверки.
- Повторные запросы используют identity-derived seeds и deterministic tie-breaks.
- Partial failures остаются видимыми по строкам, если workflow допускает
  частичный успех.
- Успех внутреннего модуля не равен успеху продукта: результат должен появиться
  в установленном Grid, Mol* или report согласно сценарию.

Переиспользуемая граница — это versioned compute protocol, MolComputeKit/Metal
runtime, snapshot/artifact contracts и typed result schemas. Grid и Mol* —
клиенты этого слоя; будущие CLI, agent, Swift или batch clients должны
использовать те же контракты вместо повторной реализации химии.

## Проверка новой сборки

1. Проверить installed app, bundle identifier, runtime attestation и Apple GPU.
2. Выполнить cluster edge case, multi-row clustering, similarity query и diverse
   export.
3. Сгенерировать ETKDGv3 из SMILES и проверить все durable stages и Mol* result.
4. Выполнить MMFF94 и MMFF94s на coordinate-bearing SDF.
5. Проверить alignment для reordered isomorphic atoms и отказ для другого graph.
6. Выполнить все восемь semi-empirical identities на known-answer fixtures.
7. Сравнить CPU/Metal, проверить manifests, hashes, artifacts и Grid writeback.
8. Проверить invalid rows, unsupported elements и memory pressure.
9. Проверить browser-preview, Quick Look и iPhone на отсутствие ложных compute
   claims.
10. Проверить реальный установленный Grid и непустой Mol* canvas, а не только
    unit/backend tests.
