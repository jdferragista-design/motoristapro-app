// MotoristaPro — estado, persistência e migração de schema

// Initial State with Parity Calculator Fuel Settings
const defaultData = {
  vehicle: {
    model: 'Chevrolet Onix Plus 1.0 Flex',
    plate: 'BRA-2E19',
    odometer: 64850,
    maintenanceReservePerKm: 0.18,
    monthlyGoal: 7000,
    targetKmRate: 2.20,
    targetHourlyRate: 35.00
  },
  fuelSettings: {
    gasolinePrice: 5.89,
    gasolineKmPerL: 11.5,
    ethanolPrice: 3.89,
    ethanolKmPerL: 8.2
  },
  shifts: [
    {
      id: 1,
      date: '2026-08-19',
      period: 'Integral',
      apps: [
        { id: 'uber_1', appKey: 'uber', name: '🚗 Uber', gross: 285.50, trips: 14, tips: 15.00, badgeClass: 'badge-uber' },
        { id: 'pop_1', appKey: 'pop', name: '🚕 99Pop', gross: 110.00, trips: 6, tips: 5.00, badgeClass: 'badge-99' }
      ],
      km: 168.4,
      hours: 9.0,
      timeStart: '07:00',
      timeEnd: '16:00',
      fuelCost: 79.88,
      fuelTypeUsed: 'Etanol',
      notes: 'Manhã no centro e tarde com dinâmico 99'
    },
    {
      id: 2,
      date: '2026-08-18',
      period: 'Integral',
      apps: [
        { id: 'uber_2', appKey: 'uber', name: '🚗 Uber', gross: 340.00, trips: 16, tips: 20.00, badgeClass: 'badge-uber' },
        { id: 'part_2', appKey: 'part', name: '⭐ Particulares', gross: 90.00, trips: 1, tips: 0, badgeClass: 'badge-part' }
      ],
      km: 180.0,
      hours: 9.2,
      timeStart: '07:30',
      timeEnd: '16:45',
      fuelCost: 85.39,
      fuelTypeUsed: 'Etanol',
      notes: 'Chuva fim de tarde + corrida particular'
    },
    {
      id: 3,
      date: '2026-08-17',
      period: 'Integral',
      apps: [
        { id: 'uber_3', appKey: 'uber', name: '🚗 Uber', gross: 295.00, trips: 13, tips: 10.00, badgeClass: 'badge-uber' },
        { id: 'pop_3', appKey: 'pop', name: '🚕 99Pop / 99', gross: 75.00, trips: 4, tips: 0, badgeClass: 'badge-99' }
      ],
      km: 165.0,
      hours: 9.0,
      timeStart: '08:00',
      timeEnd: '17:00',
      fuelCost: 78.27,
      fuelTypeUsed: 'Etanol',
      notes: 'Corridas de bairro'
    },
    {
      id: 4,
      date: '2026-08-16',
      period: 'Tarde/Noite',
      apps: [
        { id: 'indrive_4', appKey: 'indrive', name: '🚙 InDrive', gross: 165.00, trips: 6, tips: 10.00, badgeClass: 'badge-indrive' }
      ],
      km: 68.0,
      hours: 3.5,
      timeStart: '16:00',
      timeEnd: '19:30',
      fuelCost: 32.26,
      fuelTypeUsed: 'Etanol',
      notes: 'Focado em InDrive com ótima margem'
    },
    {
      id: 5,
      date: '2026-08-15',
      period: 'Integral',
      apps: [
        { id: 'uber_5', appKey: 'uber', name: '🚗 Uber', gross: 410.00, trips: 18, tips: 30.00, badgeClass: 'badge-uber' }
      ],
      km: 175.0,
      hours: 9.5,
      timeStart: '08:00',
      timeEnd: '17:30',
      fuelCost: 83.02,
      fuelTypeUsed: 'Etanol',
      notes: 'Sexta-feira movimentada'
    }
  ],
  expenses: [
    { id: 1, date: '2026-08-19', category: 'combustivel', fuelType: 'Gasolina', title: 'Abastecimento Gasolina Comum', amount: 175.50, liters: 30.0, pricePerLiter: 5.85, odo: 64800 },
    { id: 2, date: '2026-08-19', category: 'alimentacao', title: 'Almoço e café na rua', amount: 28.50 },
    { id: 3, date: '2026-08-17', category: 'lavagem', title: 'Lavagem completa + cera', amount: 45.00 },
    { id: 4, date: '2026-08-16', category: 'combustivel', fuelType: 'Etanol', title: 'Abastecimento Etanol', amount: 145.00, liters: 38.0, pricePerLiter: 3.82, odo: 64450 },
    { id: 5, date: '2026-08-10', category: 'manutencao', title: 'Alinhamento 3D + Balanceamento', amount: 110.00, odo: 63900 },
    { id: 6, date: '2026-08-05', category: 'fixo', title: 'Seguro Auto Especial App', amount: 210.00 }
  ],
  maintenance: [
    { id: 1, name: 'Troca de Óleo e Filtro (5W30)', lastKm: 60000, interval: 10000, cost: 220 },
    { id: 2, name: 'Pastilhas de Freio Dianteiras', lastKm: 45000, interval: 20000, cost: 180 },
    { id: 3, name: 'Rodízio de Pneus e Alinhamento', lastKm: 55000, interval: 10000, cost: 110 },
    { id: 4, name: 'Filtro de Ar e Cabine (A/C)', lastKm: 50000, interval: 15000, cost: 95 }
  ]
};


let state = JSON.parse(JSON.stringify(defaultData));


// Staging and Edit Tracking State
let stagedShiftApps = [];

let editingShiftId = null;

let editingExpenseId = null;

let editingMaintId = null;

let deferredPWAEvent = null;


function saveState() {
  localStorage.setItem('mp_html_state_v8', JSON.stringify(state));
  render();
}


// Validação/migração de schema: garante que restauros e loads antigos
// nunca quebrem o app por campos faltando
function migrateState(s) {
  const base = JSON.parse(JSON.stringify(defaultData));
  const vehicle = Object.assign({}, base.vehicle, (s && s.vehicle) || {});
  if (!(s && s.vehicle && Object.prototype.hasOwnProperty.call(s.vehicle, 'manualOdometerBase'))) {
    vehicle.manualOdometerBase = 0;
  }
  return {
    vehicle,
    fuelSettings: Object.assign({}, base.fuelSettings, (s && s.fuelSettings) || {}),
    shifts: Array.isArray(s && s.shifts) ? s.shifts : [],
    expenses: Array.isArray(s && s.expenses) ? s.expenses : [],
    maintenance: Array.isArray(s && s.maintenance) ? s.maintenance : []
  };
}
