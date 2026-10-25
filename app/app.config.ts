// linguitas' part of the nexitas shell: its name, icon and hue, and its section in the nav.
export default defineAppConfig({
  nexitas: {
    modules: [
      {
        id: 'linguitas',
        label: 'Translations',
        description: 'Texts per language, checked and published to your sites as JSON.',
        icon: 'globe',
        accent: 'green',
      },
    ],
    nav: [{ to: '/translations', label: 'Translations', module: 'linguitas' }],
  },
})
