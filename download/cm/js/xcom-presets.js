(function(root) {
    'use strict';

    var PRESETS = [
        {
            id: 'building-materials',
            name: 'Стройматериалы',
            description: 'Тип и размер важнее точного артикула.',
            status: 'starter',
            config: {
                category: 'Стройматериалы', preset: 'building-materials', tma_weight: 0.3,
                attribute_weights: [
                    { rfp_key: 'Тип RFP', sku_key: 'Тип SKU', weight: 0.25 },
                    { rfp_key: 'Размер RFP', sku_key: 'Размер SKU', weight: 0.2 }
                ],
                required_attributes: [{ rfp_key: 'Тип RFP', sku_key: 'Тип SKU' }]
            }
        },
        {
            id: 'stationery',
            name: 'Канцелярия',
            description: 'Брендовые серии и модели канцелярских товаров.',
            status: 'starter',
            config: {
                category: 'Канцелярия', preset: 'stationery', tma_weight: 0.4,
                attribute_weights: [
                    { rfp_key: 'Бренд RFP', sku_key: 'Бренд SKU', weight: 0.2 },
                    { rfp_key: 'Модель RFP', sku_key: 'Модель SKU', weight: 0.25 }
                ],
                required_attributes: [{ rfp_key: 'Бренд RFP', sku_key: 'Бренд SKU' }]
            }
        },
        {
            id: 'it-equipment',
            name: 'IT-техника',
            description: 'Жёсткое совпадение бренда и модели.',
            status: 'starter',
            config: {
                category: 'IT-техника', preset: 'it-equipment', tma_weight: 0.5,
                attribute_weights: [{ rfp_key: 'Тип RFP', sku_key: 'Тип SKU', weight: 0.15 }],
                required_attributes: [
                    { rfp_key: 'Бренд RFP', sku_key: 'Бренд SKU' },
                    { rfp_key: 'Модель RFP', sku_key: 'Модель SKU' }
                ]
            }
        }
    ];

    function clone(value) {
        return JSON.parse(JSON.stringify(value == null ? {} : value));
    }

    function findPreset(id) {
        var key = String(id == null ? '' : id).trim().toLowerCase();
        for (var i = 0; i < PRESETS.length; i++) {
            if (PRESETS[i].id.toLowerCase() === key) return clone(PRESETS[i]);
        }
        return null;
    }

    function applyPreset(base, preset) {
        var result = clone(base);
        var source = typeof preset === 'string' ? findPreset(preset) : clone(preset);
        if (!source || !source.config) return result;
        Object.keys(source.config).forEach(function(key) {
            result[key] = clone(source.config[key]);
        });
        return result;
    }

    function validatePreset(preset, validateConfig) {
        var errors = [];
        if (!preset || typeof preset !== 'object') return ['пресет должен быть объектом'];
        if (!String(preset.id || '').trim()) errors.push('не задан id пресета');
        if (!String(preset.name || '').trim()) errors.push('не задано имя пресета');
        if (!preset.config || typeof preset.config !== 'object') errors.push('не задан config');
        if (!errors.length && typeof validateConfig === 'function') {
            errors = errors.concat(Array.prototype.slice.call(validateConfig(preset.config)));
        }
        return errors;
    }

    var api = {
        presets: clone(PRESETS),
        findPreset: findPreset,
        applyPreset: applyPreset,
        validatePreset: validatePreset
    };

    root.XcomMatchingPresets = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
