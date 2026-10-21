import { registerModule } from '#nexitas/server/utils/nexitas'
import { linguitas } from '../core/module'

export default defineNitroPlugin(() => registerModule(linguitas))
