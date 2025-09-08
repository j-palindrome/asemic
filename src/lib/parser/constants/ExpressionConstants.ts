import { range, sum } from 'lodash'

export const CACHED = range(100).map(x => sum(range(x).map(x => 1 / (x + 1))))
