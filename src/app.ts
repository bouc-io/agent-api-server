import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './lib/swagger';
import { register as metricsRegister } from './lib/promMetrics';
import assignmentRoutes from './routes/assignmentRoutes';
import messageRoutes from './routes/messageRoutes';
import toolRoutes from './routes/toolRoutes';
import runRoutes from './routes/runRoutes';
import healthRoutes from './routes/healthRoutes';
import usageRoutes from './routes/usageRoutes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Interactive API docs (non-production only)
if (process.env.NODE_ENV !== 'production') {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
}

// Prometheus metrics (scraped via the chart's prometheus.io/scrape annotation)
app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metricsRegister.contentType);
    res.end(await metricsRegister.metrics());
});

// Health routes (before other routes for k8s probes)
app.use('/health', healthRoutes);

// API Routes
app.use('/v1/assignments', assignmentRoutes);
app.use('/v1/assignments/:assignmentId/runs', runRoutes);
app.use('/v1', messageRoutes); // Handles /messages and /assignments/:id/messages
app.use('/v1/tools', toolRoutes);
app.use('/v1/usage', usageRoutes);

// 404 + global error handler (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
