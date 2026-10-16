# Кабан: происхождение и подготовка арта

- Дата: 2026-10-16.
- Источник: встроенный маршрут `image_gen` (`host_image`), без сторонних или защищённых игровых ассетов.
- Исходники: `boar-master-raw.png`, `boar-atlas-raw.png`, `boar-actions-raw.png`.
- Промпты: `boar-master-prompt.txt`, `boar-atlas-prompt.txt`, `boar-actions-prompt.txt`.
- Обработка: Sprite Forge `generate2dsprite.py process`, сетка 8×6 и 8×3, ячейка 181×181, `native_alpha`, очистка альфа-канала, общий масштаб и выравнивание по опоре.
- Runtime: `public/assets/prey-v4/boar-atlas.png`, `public/assets/prey-v4/boar-actions.png`.
- Финальный QC: `final-qc-movement-v1/sheet-qc.json` и `final-qc-actions-v1/sheet-qc.json`; обе проверки завершены со статусом `pass` без предупреждений.

Поведенческая модель опирается на исследования выбора местообитания и суточной активности диких свиней, устойчивых матрилинейных групп и контекстной реакции на волка:

- https://pmc.ncbi.nlm.nih.gov/articles/PMC7994638/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC4053407/
- https://pubmed.ncbi.nlm.nih.gov/24925011/
- https://doi.org/10.1016/j.anbehav.2021.12.013
