import { Template } from 'meteor/templating';
import { Spacebars } from 'meteor/spacebars';

const CONFIG_COLORS = {
  transport: '#0d6efd',
  serializer: '#6610f2',
  oplog: '#198754',
};

/**
 * Render config flags as small Bootstrap badges.
 * Usage: {{{configBadges config}}}
 */
Template.registerHelper('configBadges', function (config) {
  if (!config || typeof config !== 'object') return '';
  return new Spacebars.SafeString(
    Object.entries(config)
      .map(([key, val]) => {
        const color = CONFIG_COLORS[key] || '#6c757d';
        const label = val === true ? key : `${key}: ${val}`;
        return `<span class="badge me-1" style="background-color:${color};font-size:0.7rem">${label}</span>`;
      })
      .join('')
  );
});
