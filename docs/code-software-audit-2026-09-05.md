# Аудит Burette — 5 сентября 2026

Статус: исправления A01–A21 реализованы; результаты повторной проверки приведены ниже.
Первоначальные наблюдения сохранены как описание дефектов до исправления.
База: `6a0363416af0c4380cc7f04b772c38f17741fbbc`, версия `2.3.9`, detached HEAD,
исходное рабочее дерево чистое. Хост проверки: `MacBookPro.local`, Bun `1.3.8`.

Пять независимых субагентов проверили frontend, filesystem/bridge contracts,
agent/MCP, native Quick Look/iPhone и release/CI. Основной агент сверил ключевые
места и выполнил дополнительные узкие тесты. Область — текущий репозиторий Burette,
а не все проекты и приложения пользователя.

Первоначальный этап — аудит исходников и отдельных исполняемых контрактов. Тогда полные сборки,
нагрузочные тесты, установленное приложение, Finder, iPhone, опубликованный сайт,
GitHub secrets и текущие релизные артефакты не проверялись. Научная корректность
алгоритмов и качество молекулярных расчётов в этот проход не входили.

## Как читать список

- **P1**: исправлять в первую очередь — потеря данных, нарушение границ доступа,
  отказ основного действия или несоответствие релизного артефакта исходникам.
- **P2**: следующий этап — надёжность, настройки, память, CI и release tooling.
- **Воспроизведено**: исполнен изолированный сценарий на настоящем handler/contract.
- **По исходникам**: прослежена конкретная цепочка; пользовательский сценарий ещё
  требует указанной проверки. Это не утверждение о воспроизведении в приложении.

Все пункты ниже описывают исходное состояние. Номера строк относятся к базовому commit;
статус реализации и проверки нужно читать по таблице исправлений.

## P1: данные, доступ и основные действия

### A01. Вытеснение вкладки теряет несохранённое состояние grid

**По исходникам.** `apps/desktop/src/components/editor-area/index.tsx:40` размонтирует
неактивные страницы сверх лимита 10, 6 на малопамятном устройстве или 4 при memory
pressure, без исключения dirty-документов. Изменения находятся в iframe
(`PreviewExtension/Web/grid-viewer.js:6245`), хост хранит только dirty boolean
(`apps/desktop/src/hooks/use-app-grid-control-messages.ts:141`). При новом открытии
данные восстанавливаются из исходного `BuretteGridRecords` (`grid-viewer.js:7571`).

**Исправить:** не вытеснять документы с несохранённым состоянием; долгосрочно определить
контракт восстановления редактируемого runtime. **Приёмка:** удалить строку, посетить
10 других keepAlive-вкладок и вернуться; изменение и предупреждение о несохранённом
документе сохраняются. Повторить при пониженном лимите.

### A02. Ответ Save снимает dirty с более новых изменений

**По исходникам.** `PreviewExtension/Web/grid-viewer.js:8146` отправляет snapshot без
ревизии; `:883-897` безусловно вызывает `markGridClean` при ACK. В `:6420` также
очищается undo/redo. Хост снимает dirty в
`apps/desktop/src/hooks/use-app-grid-file-actions.ts:170`. Редактирование во время
сохранения доступно; блокировка закрытия окна не обеспечивает блокировку редактора.

**Исправить:** привязать ACK к ревизии snapshot и очищать dirty только при её совпадении
с текущей. Для Save As сохранить поздние правки при перепривязке или временно запретить
редактирование. **Приёмка:** задержать запись, внести вторую правку, доставить ACK;
вторая правка остаётся dirty и не теряется при закрытии. Проверить Save и Save As.

### A03. Static agent shell принимает запросы без токена и проверки источника

**Воспроизведено на fixture-сервере.** `scripts/agent-shell-server.mjs:188` маршрутизирует
запросы без проверки token/Host/Origin; `:344-362` разрешает GET observe и PUT actions.
С заголовками `Host: attacker.example`, `Origin: http://attacker.example` и без
credentials оба запроса вернули HTTP 200. Это доказательство отсутствия server-side
защиты, а не исполненного браузерного DNS-rebinding exploit; CORS/SOP не проверялись.

**Исправить:** токен сессии для чтения и записи, проверка допустимых Host/Origin на
сервере, согласованная передача токена клиентом. **Приёмка:** без токена и с чужим
источником запросы отклоняются; авторизованные observe/action продолжают работать.

### A04. Symlink обходит allowlist static agent shell

**Воспроизведено.** `scripts/agent-shell-server.mjs:1047-1070` проверяет лексический
путь, а `:396-408` читает его с разыменованием symlink. Fixture
`allowed/linked.pdb -> outside-secret.txt` позволил получить содержимое внешнего
текстового файла через read-file, HTTP 200. Все данные fixture были синтетическими.

**Исправить:** проверять фактический канонический объект внутри разрешённого корня;
учесть подмену ссылки между проверкой и чтением. **Приёмка:** ссылка наружу запрещена,
обычный разрешённый файл читается; отдельная проверка ссылки на каталог.

### A05. Folding discovery выходит за разрешённый каталог

**Воспроизведено настоящим route handler.**
`apps/desktop/vite/browser-dev/folding-results.ts:103,324-329,681-694` проверяет входной
файл, затем поднимается на шесть родителей и читает соседние артефакты (`:394`) без
повторного ограничения. При разрешённом `root/allowed/sample.pdb` и запрещённом
`root/scores.json` результат: `status=200`, `outsideDirectAllowed=false`,
`returnedOutside=true`, `ranking_score=0.8123`.

**Исправить:** ограничить подъём разрешённым корнем и проверять каждый обнаруженный
артефакт до чтения. **Приёмка:** запрещённые соседние JSON/NPZ не читаются и не
попадают в метрики или список путей.

### A06. MDSmooth route не ограничивает входные и выходные пути

**По исходникам, вычисления не запускались.**
`apps/desktop/vite/browser-dev/mdsmooth.ts:15,27,47` передаёт JSON в Python без path
allowlist; `scripts/mdsmooth_runner.py:204-212,262-270` использует input/output
напрямую, создаёт выходной каталог и записывает результат. При наличии runtime
доступны подходящие входы и выходы за пределами разрешённых корней.

**Исправить:** валидировать канонические input и родитель output до запуска, определить
правило перезаписи. **Приёмка:** route test с заглушкой launcher: запрещённые input,
output и symlink дают 403, процесс не запускается; разрешённый сценарий проходит.

### A07. Hosted set_structure ломается при повторной валидации

**Воспроизведён контракт, HTTP/UI не запускались.**
`apps/burette-public-plugin/app/mcp/route.ts:283` передаёт `validation.value` в relay,
который повторно валидирует action. Первая нормализация добавляет `input`; вторая
отклоняет его как неизвестное поле (`INVALID_INPUT`). Нормализованный action также
возвращается в strict output schema, ожидающую исходную форму.

**Исправить:** согласовать границу raw/normalized action; валидировать ровно на
предусмотренной границе и возвращать форму, соответствующую output schema.
**Приёмка:** route-level set_structure проходит через настоящий relay и output schema;
проверить повторный actionId и конфликт ревизии.

### A08. Hosted Ketcher может очищать рисунок после действия без новой структуры

**По исходникам.** `apps/burette-public-plugin/app/mcp/route.ts:284-297` выдаёт
`ketcherSeed:null`, когда результата seed нет. `apps/burette-public-plugin/lib/widget.ts:115-122`
понимает null как пустой SMILES, а `apps/desktop/src/components/ketcher-page.tsx:528-537`
передаёт его в `setMolecule`. Чтение, highlight или ошибка могут очистить рисунок,
если пустой seed ещё не был применён с тем же ключом.

**Исправить:** отсутствие изменения структуры представлять отсутствующим полем;
явный clear оставить отдельным намеренным действием. **Приёмка:** на непустом
рисунке get/highlight/error не меняют структуру; clear очищает ровно по запросу.

### A09. Маленький malformed XYZ вызывает переполнение Swift Int

**По исходникам; native fixture не запускался.**
`PreviewExtension/Platform/PreviewViewController.swift:2787` вычисляет
`index + atomCount + 1`, `ios/BuretteMobile/MobilePreviewRuntime.swift:209-211` —
`firstAtomIndex + atomCount` до проверки границ. Положительный `Int.max` проходит
парсинг. Fixture: `9223372036854775807\ncomment\n`. Путь mobile достигается при выборе
файла (`MobilePreviewScreen.swift:2402`), Quick Look — через `makeXYZPayload`.

**Исправить:** сравнивать atomCount с числом оставшихся строк до сложения индексов.
**Приёмка:** оба парсера отклоняют Int.max и усечённые блоки без trap; обычный XYZ
продолжает работать.

### A10. Manual release может тегировать другой commit

**По исходникам и локальному `gh release create --help`.**
`.github/workflows/release.yml:180-184` не передаёт `--target`. При workflow_dispatch
отсутствующий тег создаётся из актуальной default branch, а артефакт собран из
checkout запуска. Достаточно продвижения main за время сборки или запуска с другой ветки.

**Исправить:** привязать создаваемый тег к `$GITHUB_SHA`, для существующего тега
проверять соответствие сборке. **Приёмка:** dispatch со старого commit формирует тег
именно на нём; сопоставить tag, checkout и provenance артефакта.

## P2: надёжность и контроль качества

### A11. Защита записи browser-dev проверяет устаревший mtime

**Воспроизведено.** `apps/desktop/vite/browser-dev/files.ts:268-290` делает stat до
`await readJsonBody(req)`. Изменение файла во время приёма тела не замечается.
Fixture обновил файл и mtime на 5 секунд, но handler вернул 200 и заменил внешние
данные строкой `stale editor draft` вместо ожидаемого 409.

**Исправить:** читать тело до проверки ревизии; выполнять проверку и атомарную запись
на backend с корректным контрактом конкуренции. Простая перестановка stat уменьшает
окно, но сама по себе не является полным решением TOCTOU. **Приёмка:** внешняя запись
во время приёма тела сохраняется, клиент получает конфликт.

### A12. Quick Look удерживает controller циклической ссылкой

**По исходникам.** `PreviewExtension/Platform/PreviewViewController.swift:59`
регистрирует self в WKUserContentController; controller владеет WebView, который
владеет content controller. Удаление handler только в `deinit:52` не разрывает цикл.

**Исправить:** weak proxy либо явный lifecycle teardown. **Приёмка:** многократное
открытие/закрытие освобождает controller/WKWebView и останавливает file monitor.

### A13. Старый timeout Quick Look портит новый preview

**По исходникам.** `PreviewExtension/Platform/PreviewViewController.swift:97-124`
меняет request ID, не отменяя старый timeout. Callback `:3816-3823` вызывает
`renderNativeError` раньше проверки актуальности ID в finish.

**Исправить:** отмена timer в начале запроса и проверка request ID до UI-эффектов.
**Приёмка:** задержать подготовку B и активировать timeout A; B не показывает ошибку A.

### A14. iPhone готовит файлы и assets синхронно на UI-потоке

**По исходникам, без измерений производительности.**
`ios/BuretteMobile/MobilePreviewWebView.swift:58-67,122-129` вызывает build из UIKit
update/create. `MobilePreviewRuntime.swift:701-717` читает файл целиком, удаляет cache,
копирует Web assets и формирует base64 при reload настроек. Текстовый режим также
читает весь файл до ограничения вывода (`MobileViewModes.swift:103-115`).

**Исправить:** вынести подготовку с main actor, ограничить чтение до materialization,
переиспользовать immutable assets, отклонять устаревший результат по поколению запроса.
**Приёмка:** большой файл, смена стиля и отмена на iPhone; измерить отзывчивость и память.

### A15. iPhone подтверждает применение layout до появления JS bridge

**По исходникам.** `ios/BuretteMobile/MobilePreviewWebView.swift:142-148` считает
`error == nil` подтверждением, хотя выражение с отсутствующим BuretteMobileControls
возвращает undefined без ошибки. Повтор в `didFinish:166-168` пропускается как уже применённый.

**Исправить:** положительный ACK bridge и привязка к поколению страницы.
**Приёмка:** изменить состояние панели до завершения навигации; после ready оно
реально применено в новой странице.

### A16. Settings не обновляет открытый runtime для нелокальных настроек

**По исходникам.** `apps/desktop/src/hooks/use-app-preference-effects.ts:86-96`
обновляет только active file, а в Settings выходит без действия. Эффект зависит
лишь от preferences; возврат к сохранённой keepAlive-вкладке не запускает обновление.

**Исправить:** учитывать ревизию настроек документа при активации, сохраняя dirty state.
**Приёмка:** file → Settings → изменение renderer → file; проверить два открытых
документа и отсутствие потери редактирования.

### A17. Автоматический ad-hoc release не передаёт выбранный режим в build

**Воспроизведена передача окружения без сборки.** `scripts/release.sh:130-134`
разрешает `ALLOW_ADHOC=1`, но не экспортирует `BURETTE_RELEASE_ALLOW_ADHOC`.
`scripts/build.sh:37,58-60` получает default 0 и требует Developer ID.
Результат fixture: `resolved ALLOW_ADHOC=1`, `child BURETTE_RELEASE_ALLOW_ADHOC=0`.

**Исправить:** передать resolved mode перед build. **Приёмка:** shell regression
с заглушкой build для auto без credentials, 0 и 1; strict mode остаётся строгим.

### A18. Обязательный PR CI не выполняет typecheck

**По исходникам.** `.github/workflows/ci.yml` запускает `scripts/ci-fast.sh`, где
`:9-20` отсутствует typecheck. Native build (`scripts/build.sh:584-588`) использует
Vite build без tsc. Typecheck есть в `scripts/ci.sh:15`, который этот workflow не вызывает.

**Исправить:** подключить существующий typecheck в обязательную проверку PR.
**Приёмка:** контролируемая TS-ошибка останавливает этот check до merge.

### A19. Существующие тесты выпали из CI; storage contract уже падает

**Воспроизведено падение; маршрутизация проверена по исходникам.**
`tests/test-runtime-storage-contract.mjs:56` не включает новый
`TABLE_COLUMN_WIDTHS_STORAGE_KEY` из `PreviewExtension/Web/grid-viewer.js:9`.
Это рассинхронизация теста, не доказательство ошибки настроек у пользователя.
В package/CI references также отсутствуют `test-browser-dev-trajectory-pair.mjs`,
`test-compute-schema-contract.mjs`, `test-status-error-message.mjs`.
`test:mesoscale` существует в package.json, но не вызывается ci-fast.sh/ci.sh.

**Исправить:** включить проверки в существующие группы и актуализировать намеренный
storage contract. **Приёмка:** узкие тесты проходят и есть проверяемое соответствие
test files → обязательные команды CI; не подменять поведенческие тесты regex-проверками.

### A20. Version guard разрешает уменьшение версии

**По исходникам.** `scripts/check-release-version.mjs:63-66` запрещает только равенство
base version. Меньшая ещё не тегированная версия проходит проверку увеличения версии;
существующие установки могут не предложить такой релиз как обновление.

**Исправить:** semver ordering с prerelease semantics. **Приёмка:** относительно 2.3.9
отклонять 2.3.8 и 1.99.0, принимать 2.3.10, отдельно проверить prerelease переходы.

### A21. Agent preview удерживает полные результаты и раздувает observe

**По исходникам, без нагрузочного теста.** `scripts/agent-preview.mjs:1512-1519`
добавляет actions в Map без удаления завершённой истории; `:1546-1548` сохраняет
raw result с разрешённым телом до 3 MiB. Observe (`:1145-1146`) включает последний
и 20 недавних результатов — до примерно 63 MiB плюс metadata. CLI bridge
`plugins/burette-agent/mcp/lib/cli-bridge.mjs:43-51` полностью буферизует stdout/stderr.

**Исправить:** ограниченные summaries и artifact references в observe, ограниченное
хранение завершённых результатов с сохранением pending actions. **Приёмка:** серия
результатов не увеличивает observe сверх явного byte budget; старые артефакты остаются
доступны по предусмотренным ссылкам, pending actions не теряются.

## Дополнительные наблюдения первоначального аудита

- **FEP HTML injection:** `apps/desktop/src/components/editor-area/page-kinds/fep-network.tsx:941-942`
  вставляет JSON непосредственно в script без escaping `<`; `:876` переносит node.label
  в record.name. Проверить GraphML с XML-encoded `</script>` до исполнения в iframe.
  `viewer-frame.tsx:19` использует разные sandbox для native/browser; влияние на parent
  и доступ к bridge требует отдельной проверки. Исправление-кандидат: безопасная
  сериализация JSON для HTML по существующей практике проекта.
- **Ограничение тела HTTP:** `apps/desktop/vite/browser-dev/http.ts:3-9` буферизует тело
  до validation. Проверить ранний byte limit и oversized request без нагрузочного
  воздействия на рабочую сессию.
- **Поддерживаемость:** дальнейшие изменения App.tsx, use-app-shell-actions.ts и
  molecule-store.ts делать по небольшим доменным границам; массовый рефакторинг не
  нужен для перечисленных исправлений. Приоритет — владение dirty state, ревизиями
  и lifecycle, а не механическое уменьшение числа строк.

## Проверки первоначального аудита

| Проверка | Результат |
| --- | --- |
| `bun tests/test-window-mutation-barrier.mjs` | PASS |
| `bun tests/test-viewer-bridge-message-contract.mjs` | PASS |
| `bun tests/test-runtime-storage-contract.mjs` | FAIL: отсутствует ожидаемый column-widths key |
| `bun tests/test-grid-save-materialization.mjs` | PASS |
| `bun tests/test-grid-runtime-lifecycle-contract.mjs` | PASS |
| `bun tests/test-source-editing-state.mjs` | PASS |
| `node scripts/check-release-version.mjs` | PASS для текущей версии; downgrade этим запуском не проверялся |
| Изолированные folding/files handlers | Воспроизведены A05/A11 |
| Изолированный static agent shell | Воспроизведены A03/A04 |
| Повторная валидация Ketcher action | Воспроизведён A07 на contract module |
| Signing mode с заглушкой child build | Воспроизведён A17 |

Fixture-проверки использовали синтетические данные; временные файлы удалены.
Успешные тесты не проверяют все гонки и не доказывают исправность native/hosted UI.

## Первоначальная очерёдность исправлений

1. A01/A02/A11: сохранность пользовательских правок, отложенный Save и вытеснение вкладок.
2. A03–A06/A21: server-side доступ, пути и объём agent context; затем проверить FEP injection.
3. A07/A08/A09: Ketcher и отказоустойчивость разбора входных файлов.
4. A10/A17–A20: соответствие релиза исходникам и обязательные проверки CI.
5. A12–A16: native lifecycle, mobile responsiveness и применение настроек.

Этапы реализованы как reproducer → минимальное исправление → focused regression →
проверка соответствующей поверхности. Границы выполненной приёмки указаны ниже.


## Исправления и повторная проверка

Рабочая ветка: `audit/code-software-2026-09-05`. Изменения разделены на тематические
commits. «Исправлено» здесь означает исправленный код и указанные regression checks;
это не означает проверку установленного native приложения или публикацию релиза.

| Пункты | Исправление | Commit | Исполняемая проверка |
| --- | --- | --- | --- |
| A01/A02/A16 | Dirty-вкладки сохраняют runtime; Save ACK привязан к ревизии; Save As блокирует редактирование до завершения; нелокальные настройки применяются с отложенной перезагрузкой чистого документа | `924f2317` | `test-viewer-dirty-retention`, `test-grid-save-lifecycle`, `test-preference-runtime-refresh`; Browser: удаление строки и возврат после 10 других вкладок сохраняют правку и dirty; смена renderer и возврат также сохраняют правку |
| A03/A04 | Token/cookie bootstrap, Host/Origin checks, canonical roots, чтение проверенного файлового дескриптора | `a994e9bb` | `test-agent-shell-security`: HTTP, file/directory symlinks, parent-swap race; CLI и Amber tests |
| A05/A06/A11 | Folding ограничен разрешёнными корнями; MDSmooth проверяет input/output и не перезаписывает input; запись файла проверяет свежий stat и заменяет подготовленный файл атомарно | `58a9523d` | Browser-dev path boundaries, mdsmooth paths, text files; на Mac проверены mode и xattrs |
| A07/A08 | MCP отправляет исходный action, не повторно нормализованный; seed передаётся только при явном успешном изменении структуры | `3f70544b` | Hosted MCP wire + Ketcher relay/widget |
| A09/A12/A13 | Проверка остатка XYZ без переполнения; weak script handler; отмена старого timeout и проверка request generation | `f65c3b39` | `test-quicklook-native-regressions`: настоящий Swift parser, ARC lifetime, отменённые/старые callbacks |
| A09/A14/A15 | iOS parser без переполнения; подготовка в serial background queue, generation guard, ограниченные preview/text, кеш assets; положительный JS ACK, команды ожидают ready текущего поколения | `fddfae75`, `84be4a2a` | Swift runtime harness, `test-mobile-panel-ack`, typecheck всех iOS Swift sources с iOS 17 SDK |
| A10/A17/A18/A19/A20 | Release target привязан к GITHUB_SHA; signing mode экспортирован; обязательны typecheck/mesoscale и пропущенные тесты; semver ordering | `701d7213`, `68f8ea9c`, `b55834d7` | Release shell fixtures, git/tag version matrix, storage contract и required test groups |
| A21 | Inline result ≤4 KiB, observe ≤256 KiB, история 100 completed действий с сохранением pending и metadata двух активных панелей; raw results доступны как artifacts; CLI output ≤4 MiB | `0c898301`, `b55834d7` | `test-agent-preview-server`: большие результаты и наблюдения, pending actions, artifact roundtrip; CLI bridge output tests |
| Дополнительно: FEP HTML | JSON экранирует `<` до вставки в script | `c9c70a43` | `test-fep-grid-html`: VM execution и roundtrip вредоносной строки |
| Дополнительно: HTTP body | Ограничение входного тела до накопления/JSON parsing; 413 закрывает соединение без повреждения следующего запроса | `58a9523d`, `80124934`, `5dc9029d` | `test-browser-dev-http`: chunked/Content-Length 413 и следующий корректный запрос; Node на Mac/Linux и отдельные Node/Bun client/server процессы |
| Дополнительно: Browser Open | Browser runtime использует HTML file picker | `924f2317` | `test-browser-open-picker`; Browser file chooser открывает CSV и показывает обе строки |

A11 предотвращает устаревшую запись в проверенных сценариях оптимистической
конкурентности; она не вводит системную блокировку против произвольного внешнего
процесса, меняющего файл между последней проверкой и rename.

Нативная граница проверки: Swift harness и SDK typecheck выполнены на
`MacBookPro.local`; установка app/Quick Look, Finder preview, iPhone device performance
и release signing/notarization в этой задаче не запускались. Linux явно пропускает
Apple-only исполняемые Swift checks, не выдавая их за PASS.


### Интеграционная проверка и артефакты

На проверенном хосте `Gauss` использован изолированный checkout исходного commit
`80124934c0506f753ecd2caa8c0e5b00f78cf179`, Node `24.13.0`, Bun `1.3.8`.
`bun run typecheck` и `node scripts/build-agent-shell-plugin.mjs` завершились успешно.
Сгенерированный plugin перенесён обратно через rsync и закоммичен в `4738e646`;
`test-packaged-plugin-mirror` подтверждает 23 runtime-файла и 6 scripts.
Синхронизация также устранила прежнее расхождение копии `viewer-runtime.css` с
исходником; generated-файлы вручную не редактировались.

| Группа | Результат и граница |
| --- | --- |
| `test:agent` | PASS на `80124934`, включая hosted wire/relay, HTTP auth/path tests, preview artifacts и bundled MCP |
| `test:ui` | PASS на `5dc9029d` со всеми тестами; HTTP integration запускается через Node |
| `test:update` | PASS на `80124934`; Apple-only Swift execution явно SKIP на Linux, отдельно PASS на Mac |
| `test:mesoscale` | PASS на `68f8ea9c`; последующие изменения эту поверхность не затрагивают |
| `test:plugin` | PASS на `68f8ea9c` после сборки; финальный bundled MCP повторно покрыт `test:agent` |
| `check:formats`, `check:vendor-assets`, `check:js` | PASS на Mac |
| pre-commit | Plist validation, JS syntax и Rust fmt PASS |

HTTP regression сначала обнаружил отдельный дефект Bun 1.3.8: при HTTP client/server
в одном процессе на Gauss получилось 4/10 успешных прогонов, при Node — 10/10.
Все четыре комбинации Node/Bun client → server в отдельных процессах дали 10/10.
Поэтому тест выполняется под Node, соответствующим runtime Vite+, без удаления
проверок overflow и последующего корректного запроса. Это не доказательство
отсутствия ошибок в самом Bun и не причина менять зависимости проекта.

Логи сохранены в `build/audit-validation/remote/`, браузерная приёмка — в
`build/audit-validation/browser-settings-dirty.txt`. Временные fixture-файлы,
передаточные bundles, изолированный Linux checkout и проверочные процессы удалены после проверки. Native
release bundle не собирался и не устанавливался; GitHub CI и публикация не запускались.
