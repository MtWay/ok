import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { loadTasks, createTask, updateTask, deleteTask, getTask } from './storage.js'
import { scheduleTask, unscheduleTask, rescheduleTask, manualTrigger } from './scheduler.js'
import type { NotifyTask } from './types.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3031

app.use(cors())
app.use(express.json())

// Initialize: load all tasks and schedule enabled ones
async function initialize() {
  const tasks = await loadTasks()
  tasks.filter(t => t.enabled).forEach(scheduleTask)
  console.log(`[API] Initialized ${tasks.length} tasks, ${tasks.filter(t => t.enabled).length} enabled`)
}

// GET /api/notify/tasks - Get all tasks
app.get('/api/notify/tasks', async (req, res) => {
  try {
    const tasks = await loadTasks()
    res.json(tasks)
  } catch (err) {
    console.error('[API] Error loading tasks:', err)
    res.status(500).json({ error: 'Failed to load tasks' })
  }
})

// POST /api/notify/tasks - Create a new task
app.post('/api/notify/tasks', async (req, res) => {
  try {
    const taskData = req.body as Omit<NotifyTask, 'id' | 'createdAt' | 'updatedAt'>
    const task = await createTask(taskData)

    if (task.enabled) {
      scheduleTask(task)
    }

    res.json(task)
  } catch (err) {
    console.error('[API] Error creating task:', err)
    res.status(500).json({ error: 'Failed to create task' })
  }
})

// PUT /api/notify/tasks/:id - Update a task
app.put('/api/notify/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params
    const updates = req.body as Partial<NotifyTask>
    const updatedTask = await updateTask(id, updates)

    if (!updatedTask) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Reschedule if enabled, otherwise unschedule
    if (updatedTask.enabled) {
      rescheduleTask(updatedTask)
    } else {
      unscheduleTask(updatedTask.id)
    }

    res.json(updatedTask)
  } catch (err) {
    console.error('[API] Error updating task:', err)
    res.status(500).json({ error: 'Failed to update task' })
  }
})

// DELETE /api/notify/tasks/:id - Delete a task
app.delete('/api/notify/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params
    unscheduleTask(id)
    const deleted = await deleteTask(id)

    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[API] Error deleting task:', err)
    res.status(500).json({ error: 'Failed to delete task' })
  }
})

// POST /api/notify/tasks/:id/toggle - Toggle task enabled status
app.post('/api/notify/tasks/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params
    const task = await getTask(id)

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    const updatedTask = await updateTask(id, { enabled: !task.enabled })

    if (updatedTask!.enabled) {
      scheduleTask(updatedTask!)
    } else {
      unscheduleTask(id)
    }

    res.json(updatedTask)
  } catch (err) {
    console.error('[API] Error toggling task:', err)
    res.status(500).json({ error: 'Failed to toggle task' })
  }
})

// POST /api/notify/tasks/:id/trigger - Manually trigger a task
app.post('/api/notify/tasks/:id/trigger', async (req, res) => {
  try {
    const { id } = req.params
    const task = await getTask(id)

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Trigger async, don't wait for completion
    manualTrigger(task).catch(err => {
      console.error('[API] Manual trigger error:', err)
    })

    res.json({ success: true, message: 'Task triggered' })
  } catch (err) {
    console.error('[API] Error triggering task:', err)
    res.status(500).json({ error: 'Failed to trigger task' })
  }
})

app.listen(PORT, () => {
  console.log(`[API] Notify service listening on port ${PORT}`)
  initialize()
})
