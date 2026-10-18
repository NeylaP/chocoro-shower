# Chocoro Shower — invitaciones con lista de chócoros

Página web gratuita para inauguraciones de casa (uno o varios Chocoro Shower):

- **`index.html`**: la invitación. Cada invitado abre su enlace personal (`…/?c=CODIGO`) y ve su nombre y los datos de **su** evento. Puede decir que no asiste, o confirmar y elegir **un** chócoro. Si un chócoro ya no tiene cupos, aparece bloqueado.
- **`admin.html`**: el panel, con login y tres módulos:
  - **Invitados**: crear invitados, copiar su enlace, enviarlo por WhatsApp y eliminarlos.
  - **Chócoros**: crearlos con número de cupos, subir o bajar cupos y ver quién lo lleva.
  - **Eventos** (solo el **super admin**): crear eventos y editar fecha, hora, dirección, enlace de Maps, fecha límite y anfitriones.
  - **Anfitriones** (solo el **super admin**): crear cuentas con contraseña, cambiar contraseñas, asignar eventos y eliminar cuentas.

Las listas se ven en tablas, y crear o editar se hace en una ventana (modal).

Hay dos roles:

| Rol | Qué puede hacer |
|---|---|
| **Super admin** | Todo: crea y edita eventos, crea anfitriones con su contraseña y administra los invitados y chócoros de cualquier evento. |
| **Anfitrión** | Solo los eventos donde su correo está asignado: invitados y chócoros. Ve los datos del evento, pero no los edita. |

Sin configurar nada funciona en **modo demo**: datos de ejemplo guardados solo en tu navegador. Para probarlo, entra con `super@demo.com`, `ana@demo.com` o `sofia@demo.com` y cualquier contraseña.

Todo es gratis: **Supabase** (base de datos y login) + **Netlify** o **GitHub Pages** (la página).

---

## 1. Crear la base de datos en Supabase (10 min)

1. Entra a <https://supabase.com>, crea una cuenta y un **New project** (plan Free).
2. Ve a **SQL Editor → New query**, pega todo `supabase/schema.sql` y pulsa **Run**.
3. Hazte super admin. En el SQL Editor ejecuta:
   ```sql
   insert into public.super_admins (email) values ('tu-correo@ejemplo.com');
   ```
4. Crea **tu** usuario (solo el tuyo, una vez): **Authentication → Users → Add user → Create new user**, con ese correo y una contraseña. Marca **Auto Confirm User**.
5. Desactiva el registro libre en **Authentication → Sign In / Providers → Allow new users to sign up**. Las cuentas de los anfitriones las creas tú desde el panel.
6. Ve a **Project Settings → API** y copia la **Project URL** y la **anon public key**.

## 2. Crear la función para las contraseñas de los anfitriones (3 min)

Para que el panel pueda crear cuentas y poner contraseñas, hace falta una pequeña función en el servidor de Supabase. Ahí se usa la clave secreta, que nunca llega a la página.

1. En Supabase ve a **Edge Functions → Deploy a new function → Via Editor**.
2. Ponle de nombre exactamente **`manage-hosts`**.
3. Borra el código de ejemplo, pega todo `supabase/functions/manage-hosts/index.ts` y pulsa **Deploy function**.

No hay que configurar nada más: Supabase le da a la función la URL y la clave secreta automáticamente. La función solo obedece a quien esté en `super_admins`.

### Cómo creas un anfitrión

1. En el panel, abre **Anfitriones → + Nuevo anfitrión**.
2. Escribe su nombre y correo, ponle una contraseña (o usa **Generar**) y marca sus eventos.
3. Al guardar aparecen sus datos de acceso (panel, correo y contraseña) con un botón **Copiar** para enviárselos.
4. Si la olvida, usa **Contraseña** en su fila y ponle una nueva.

## 3. Configurar la página

Abre `config.js` y pega tus datos:

```js
window.SUPABASE_URL = 'https://xxxx.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

Los datos de cada fiesta (fecha, hora, dirección, anfitriones) se manejan desde el módulo **Eventos** del panel.

La clave `anon` es pública por diseño. La seguridad la dan las reglas de la base de datos: los invitados solo pueden usar las funciones de su propio código, y cada anfitrión solo ve sus eventos.

## 4. Publicar gratis

**Opción A: Netlify Drop (la más fácil)**
1. Entra a <https://app.netlify.com/drop> y crea una cuenta.
2. Arrastra la carpeta `chocoro-shower` completa.
3. En **Site configuration → Change site name** ponle algo como `chocoro-casa`. Tu página queda en `https://chocoro-casa.netlify.app`.
4. Cada vez que cambies algo, vuelve a arrastrar la carpeta en **Deploys**.

**Opción B: GitHub Pages**
1. Crea un repositorio público y sube estos archivos.
2. **Settings → Pages → Deploy from a branch → main / root**.
3. Queda en `https://tu-usuario.github.io/nombre-repo/`.

**Otras opciones gratis:** Cloudflare Pages o Vercel, arrastrando la carpeta o conectando el repositorio.

## 5. Usarlo

1. Entra a `https://tu-sitio/admin.html`.
2. **Anfitriones** (super admin): crea a los anfitriones con su contraseña.
3. **Eventos** (super admin): crea el evento con su fecha, hora y dirección, y marca sus anfitriones.
4. Elige el evento en el selector del menú lateral.
5. **Chócoros**: agrega la lista. En "¿Cuántas personas lo pueden llevar?" deja 1 si solo una persona puede llevarlo, o súbelo (por ejemplo, 3 para toallas).
6. **Invitados**: agrega a cada persona y envíale su enlace con **Copiar** o **WhatsApp**.

## Reglas que garantiza la base de datos

- Cada invitado puede tener **un solo** chócoro. Si elige otro, el anterior se libera.
- Un chócoro nunca pasa de su número de cupos, aunque dos personas lo elijan en el mismo segundo.
- No puedes bajar los cupos por debajo de los que ya están apartados.
- Si un invitado dice que no va, su chócoro se libera. Si eliminas un invitado o un chócoro, sus apartados se borran.
- Los invitados no pueden ver los nombres de los demás ni la lista de invitados.
- Un chócoro de un evento no se puede apartar con el enlace de otro evento.
- Si eliminas un evento, se borran sus invitados, chócoros y apartados.

## Notas

- En el plan gratis, Supabase **pausa los proyectos que pasan una semana sin actividad**. Si lo creas con mucha anticipación, entra al panel de vez en cuando o reactívalo desde el dashboard de Supabase.
- Los números de 10 dígitos se tratan como celulares de Colombia (+57) para el botón de WhatsApp.

## Archivos

| Archivo | Para qué |
|---|---|
| `config.js` | Tus claves de Supabase |
| `index.html`, `invite.js` | Invitación del invitado |
| `admin.html`, `admin.js` | Panel del anfitrión |
| `api.js` | Conexión con Supabase y modo demo |
| `styles.css` | Estilos compartidos |
| `supabase/schema.sql` | Tablas, reglas de seguridad y funciones |
| `supabase/functions/manage-hosts/index.ts` | Función que crea cuentas y cambia contraseñas de anfitriones |
