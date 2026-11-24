"""Export the three supported rows of SC's balance workbook (requires openpyxl)."""
import json
import math
import sys
from openpyxl import load_workbook


def export_units(path):
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        rows = iter(workbook['单位配置表'].values)
        next(rows)
        next(rows)
        columns = {str(name).split('\n')[0]: i for i, name in enumerate(next(rows))}
        roles = {'跳虫': '轻型', '狂热者': '中型', '机枪兵': '重型'}
        result = {}
        for row in rows:
            name = row[columns['单位名称']]
            if name not in roles:
                continue
            tier = roles[name]
            if tier in result:
                raise ValueError(f'重复的兵种行 {name}')
            stats = {key: row[columns[field]] for key, field in [
                ('hp', '血量'), ('damage', '攻击力'), ('range', '射程'), ('attacksPerSecond', '攻速'),
                ('productionSeconds', '生产时间'), ('spawnCount', '单次生产')]}
            for field, value in stats.items():
                if not isinstance(value, (float, int)) or not math.isfinite(value) or value <= 0:
                    raise ValueError(f'{name} {field} 须为正数')
                if field in ('hp', 'damage', 'spawnCount') and int(value) != value:
                    raise ValueError(f'{name} {field} 须为整数')
            if stats['attacksPerSecond'] > 2:
                raise ValueError(f'{name} 攻速超过每拍一次的支持范围')
            result[tier] = {'name': name, **stats}
        if set(result) != set(roles.values()):
            raise ValueError('单位配置表缺少首批兵种')
        return {tier: result[tier] for tier in roles.values()}
    finally:
        workbook.close()


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('用法：python3 tools/export-sc-units.py <sc项目战斗数值.xlsx>')
    print(json.dumps(export_units(sys.argv[1]), indent=2, ensure_ascii=False))
