import { registerModule } from '#nexitas/server/utils/nexitas'
import { linguitas } from '#self/server/core/module'

export default defineNitroPlugin(() => registerModule(linguitas))
