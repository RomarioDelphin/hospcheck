// HospCheck — CLI para (re)semear dados de demonstração
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';
const { semear } = await import('./seed.js');
const forcar = process.argv.includes('--forcar');
const r = semear({ forcar });
if (r.pulado) console.log('Base já possui dados. Use --forcar para recriar a demonstração.');
else console.log(`Dados de DEMONSTRAÇÃO criados. Hospital: ${r.hospital_id} | equipamentos: ${r.equipamentos} | usuários: ${r.usuarios}`);
